var _ = require('underscore');
var oauth = require("cloud/libs/oauth.js");


Parse.Cloud.job('getTweetsFromTwitter', function (request, status) {

    Parse.Cloud.useMasterKey();

    Parse.Config.get().then(function (config) {
        var listSlugs = config.get('listSlugs');

        var tweetPromises = _.map(listSlugs, function (listSlug) {
            return getTweets(listSlug, config);
        });

        Parse.Promise.when(tweetPromises).then(function () {
            status.success('New tweets successfully saved');
        }, function (error) {
            status.error('Failed to get new tweets:', error);
        });
    });
});


function getUserFromTweet(tweet) {
    return {
        name: tweet.user.name,
        screen_name: tweet.user.screen_name,
        profile_image_url: tweet.user.profile_image_url
    }
}


function getTweets(listSlug, config) {

    // --- extract config

    var screenName = config.get('screenName');
    var consumerSecret = config.get('consumerSecret');
    var tokenSecret = config.get('accessTokenSecret');
    var oauth_consumer_key = config.get('consumerKey');
    var oauth_token = config.get('accessToken');


    // --- get last tweet saved in Parse.com to setup twitter query

    var Tweet = Parse.Object.extend('Tweet');

    var lastTweetPromise = new Parse.Query(Tweet)
        .equalTo('list_slug', listSlug)
        .descending('id_str')
        .limit(1)
        .find();


    // --- get tweets data from twitter

    var twitterHttpResponsePromise = lastTweetPromise.then(function (results) {

        var urlLink = 'https://api.twitter.com/1.1/lists/statuses.json?count=200';
        urlLink += '&owner_screen_name=' + screenName;
        urlLink += '&slug=' + listSlug;

        if (results.length > 0) {
            var lastTweetId = results[0].get('id_str');
            urlLink += '&since_id=' + lastTweetId;
        }

        var nonce = oauth.nonce(32);
        var ts = Math.floor(new Date().getTime() / 1000);
        var timestamp = ts.toString();

        var accessor = {
            consumerSecret: consumerSecret,
            tokenSecret: tokenSecret
        };

        var params = {
            oauth_version: '1.0',
            oauth_consumer_key: oauth_consumer_key,
            oauth_token: oauth_token,
            oauth_timestamp: timestamp,
            oauth_nonce: nonce,
            oauth_signature_method: 'HMAC-SHA1'
        };

        var message = {
            method: 'GET',
            action: urlLink,
            parameters: params
        };

        oauth.SignatureMethod.sign(message, accessor);

        var normPar = oauth.SignatureMethod.normalizeParameters(message.parameters);
        var baseString = oauth.SignatureMethod.getBaseString(message);
        var sig = oauth.getParameter(message.parameters, 'oauth_signature') + '=';
        var encodedSig = oauth.percentEncode(sig);

        return Parse.Cloud.httpRequest({
            method: "GET",
            url: urlLink,
            headers: {
                Authorization: 'OAuth oauth_consumer_key="' + oauth_consumer_key + '", oauth_nonce=' + nonce + ', oauth_signature=' + encodedSig + ', oauth_signature_method="HMAC-SHA1", oauth_timestamp=' + timestamp + ',oauth_token="' + oauth_token + '", oauth_version="1.0"'
            }
        })
    });


    // --- parse twitter response and save tweets to Parse.com

    return twitterHttpResponsePromise.then(function (httpResponse) {

        var tweets = JSON.parse(httpResponse.text);

        console.log('got ' + tweets.length + ' tweets from twitter api');

        var parseTweets = _.map(tweets, function(tweet) {

            var parseTweet = new Tweet();

            var retweet = tweet.retweeted_status;

            parseTweet.set("id_str", tweet.id_str);
            parseTweet.set("list_slug", listSlug);
            parseTweet.set("tweet_created_at", tweet.created_at);
            parseTweet.set("created_at", retweet ? retweet.created_at : tweet.created_at);
            parseTweet.set("text", retweet ? retweet.text : tweet.text);
            parseTweet.set("user", getUserFromTweet(tweet));
            parseTweet.set("source", tweet.source);
            parseTweet.set("retweet_count", tweet.retweet_count);
            parseTweet.set("favorite_count", tweet.favorite_count);

            parseTweet.set("entities", {
                urls: retweet ? retweet.entities.urls : tweet.entities.urls,
                media: retweet ? retweet.entities.media : tweet.entities.media
            });

            if (retweet) {
                parseTweet.set('retweet', {
                    createdAt: retweet.created_at,
                    user: getUserFromTweet(retweet),
                    id_str: retweet.id_str
                });
            }

            return parseTweet;
        });

        console.log('saving ' + parseTweets.length + ' tweets in Parse');

        return Parse.Object.saveAll(parseTweets);
    });
}

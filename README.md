jabber-bnc
==========

This is a [bouncer][1] for the Internet Relay Chat, which is accessed via
a Jabber client.

Especially useful is the [Conversations client for Android][2], which is the
best available IRC client for Android when combined with this script.


Install
=======

Clone this git repository to your server. Run `npm install` in this directory
to pull in the dependencies `node-irc` and `node-xmpp-component`.

Create a `config.js` with contents similar to this:

```
module.exports = {

    // You need to have access to a Jabber server to which you can attach
    // this component. This is tested with Prosody[3] jabber server, but might
    // work with others as well.

    xmppComponentJid: "irc.jabber.example.org",
    xmppComponentSecret: "xxxxxxxxxxxxxx",
    xmppHost: "127.0.0.1",
    xmppPort: 5347,

    // Allow some jabber ids to connect to this component
    users: {
	"somebody@jabber.example.org": {
            // Define the IRC networks to connect to
            // Note: all these connections are established immediately at startup
	    connections: {
		freenode: {
		    server: "chat.freenode.net", nick: "changethisnick", 
		    params: { channels: [ "#d120" ],
			    port: 7000, secure: true, selfSigned: true }
		},
		hackint: {
		    server: "irc.hackint.org", nick: "changethisnick", 
		    params: { channels: ["#test"],
			    port: 9999, secure: true, selfSigned: true }
		}
	    }
	}
    }
};
```

Run with `node index.js`. To keep it running in the background, I use [daemontools][4].


[1]: http://en.wikipedia.org/wiki/BNC_%28software%29
[2]: https://github.com/siacs/Conversations
[3]: http://prosody.im/
[4]: http://cr.yp.to/daemontools.html


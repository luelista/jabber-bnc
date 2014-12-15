
var irc = require("irc"),
    Component = require('node-xmpp-component'),
    ltx = require('node-xmpp-component/node_modules/node-xmpp-core').ltx,
    fs = require("fs");

var config = require("./config");

var component = new Component({
  jid: config.xmppComponentJid,
  password: config.xmppComponentSecret,
  host: config.xmppHost,
  port: Number(config.xmppPort),
  reconnect: true
});


function startIRCConnections() {
    var occupantsCache;
    try { occupantsCache = JSON.parse(fs.readFileSync("./occupants_cache.json")); } catch(e) { occupantsCache={}; }
    for(var i in config.users) {
	var user = config.users[i];
	for(var j in user.connections) {
	    var conn = user.connections[j];
	    var client = new irc.Client(conn.server, conn.nick, conn.params);
	    initClient(client, i, user, j, conn);
	    conn.client = client;
	    if(occupantsCache[i] && occupantsCache[i][j]) conn.sendTo = occupantsCache[i][j];
	}
    }
}

function sendIRCMessageToXMPP(network, conn, from, chanName, message, xmppMsgId) {
    if (!xmppMsgId) xmppMsgId = randId();
    for(var i in conn.sendTo) {
	var msg = xmppMessage(network + '_' + chanName, from, i, message, xmppMsgId, +new Date());
	xmppSend('Msg in chan '+chanName, msg);
    }
}

function initClient(client, jid, user, network, conn) {
    conn.sendTo = {};
    client.addListener('message', function(from, chanName, message) {
	sendIRCMessageToXMPP(network, conn, from, chanName, message);
    });
    client.addListener('pm', function(from, message) {
	var msg = new ltx.Element('message', { type: 'chat', from: network + '_' + from + '@' + myJid, to: jid });
	msg.c('body').t(message);
	xmppSend("PM", msg);
    });
    client.addListener('subject', function(chanName, topic, by) {
	for(var i in conn.sendTo) {
	    var msg = xmppSubjectMessage(network+'_'+chanName, by, i, topic);
	    xmppSend('subject', msg);
	}
    });
    client.addListener('part', function(chanName, who, reason) {
	for(var i in conn.sendTo) {
	    xmppSendPresence(network+'_'+chanName+'@'+myJid+'/'+who, i, null, null, 'unavailable', reason);
	}
    });
    client.addListener('kick', function(chanName, who, by, reason) {
	for(var i in conn.sendTo) {
	    xmppSendPresence(network+'_'+chanName+'@'+myJid+'/'+who, i, null, null, 'unavailable', 'kicked by '+by+': '+reason);
	}
    });
    client.addListener('quit', function( who, channels,reason) {
	for(var i in conn.sendTo) {
	    for(var k in channels)
		xmppSendPresence(network+'_'+channels[k]+'@'+myJid+'/'+who, i, null, null, 'unavailable', reason);
	}
    });
    client.addListener('join', function(chanName, who) {
	for(var i in conn.sendTo) {
	    xmppSendPresence(network+'_'+chanName+'@'+myJid+'/'+who, i);
	}
    });
    client.addListener('error', function(err) {
	console.log("IRC client error ("+network+")", err);
    });
}


process.on('SIGINT', function() {
    saveOccupants();
    process.exit(0);
});

process.on('SIGTERM', function() {
    saveOccupants();
    process.exit(0);
});

process.on('SIGHUP', function() {
    saveOccupants();
});

function saveOccupants() {
    console.log("Saving occupants...");
    var out = {};
    for(var i in config.users) {
	out[i] = {};
	for(var k in config.users[i].connections) {
	    out[i][k] = config.users[i].connections[k].sendTo;
	}
    }
    fs.writeFileSync("./occupants_cache.json", JSON.stringify(out));
}

var XMLNS_MUC = "http://jabber.org/protocol/muc";
var JABBER_ID_REGEX = /^([a-zA-Z0-9_.#%-]+)@([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_. %-]+)$/;
var JABBER_ID_REGEX_LIBERAL = /^([a-zA-Z0-9_.#%-]+)@([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.#% 噛麾����ｧ-]+)$/;
var JABBER_ID_REGEX2 = /^([a-zA-Z0-9_.#%-]+)@([a-zA-Z0-9_.-]+)/;
var myJid = config.xmppComponentJid;

component.on('online' ,function() {
    console.log('Component is online as '+myJid);
    startIRCConnections();
});

component.on('stanza', onXmppStanza);

component.on('error', function(e) {
    console.error(" ! XMPP error: " + e);
});

function onXmppStanza(stanza) {
    console.log('--- Received stanza: ', stanza.toString());
    
    if (stanza.getChild('error')) console.log(" ! ERROR STANZA");
    
    var bareJid = stanza.attrs.from.replace(/\/.*$/, "");


    //--> iq stanza (service discovery)
    if (stanza.is('iq') && stanza.attrs.type == 'get') {
	var recp = stanza.attrs.to.split(/@/);
	
	//-->  - chat service announcement, list all chatrooms
	if (recp.length == 1 && recp[0] == myJid) {
	    if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
		var disco = discoReply(stanza, query), d = disco.getChild('query');
		d.c('identity', { category: 'conference', type: 'text', name: 'jabber-bnc' });
		d.c('feature', { 'var': 'http://jabber.org/protocol/muc' });
		xmppSend("sent info stanza : ", disco);
	    }
	    if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
		var disco = discoReply(stanza, query), d = disco.getChild('query');
		var user = config.users[bareJid];
		if (user) {
		    for (var i in user.connections) {
			var chans = user.connections[i].params.channels;
			for (var j in chans) {
			    d.c('item', { jid: i+'_'+chans[j] + '@' + myJid });
			}
		    }
		}
		xmppSend("sent items stanza : ", disco);
	    }
	}
	
/*	//--> - chatroom details, member list
	if (recp.length == 2 && recp[1] == myJid) {
	    var room = rooms[recp[0]];
	    if (room && ! (room.properties && room.properties.hidden == "true") ) {
		if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
		    var disco = discoReply(stanza, query), d = disco.getChild('query');
		    disco.attrs.from = stanza.attrs.to;
		    d.c('identity', { category: 'conference', type: 'text', name: room.subject||recp[0] });
		    d.c('feature', { 'var': XMLNS_MUC });
		    d.c('feature', { 'var': 'muc_open' });
		    d.c('feature', { 'var': 'muc_permanent' });
		    d.c('feature', { 'var': 'muc_public' });
		    if(room.properties && room.properties['password-required'])
			d.c('feature', { 'var': 'muc_passwordprotected' });
		    
		    xmppSend("sent info stanza : ", disco);
		}
		if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
		    var disco = discoReply(stanza, query), d = disco.getChild('query');
		    disco.attrs.from = stanza.attrs.to;
		    for(var i in room.members)
			d.c('item', { jid: stanza.attrs.to + '/' + room.members[i].nick });
		    xmppSend("sent items stanza : ", disco);
		}
	    } else {
		var disco = discoReply(stanza, query), d = disco.getChild('query');
		xmppSend("sent empty result stanza : ", disco);
	    }
	}*/
    }    




    
    if (stanza.is('presence')) {
	var r;
	if (stanza.attrs.type == "error") {
	    console.log("  !  received error stanza");
	} else if (( r = stanza.attrs.to.match(JABBER_ID_REGEX)  )) {
	    if (stanza.attrs.type == "unavailable") {
		return; //ignore
	    }
	    var xMucChild = stanza.getChild("x", "http://jabber.org/protocol/muc"), historyChild = null, passwdProvided = null, xmppshow = null;
	    if (xMucChild) {
		historyChild = xMucChild.getChild("history");
		passwdProvided = xMucChild.getChildText("password");
		xmppshow = xMucChild.getChildText("show");
	    }
	    xmppJoinRoom(r[1], r[2], r[3], stanza.attrs.from, historyChild, passwdProvided, xmppshow);
	    
	} else {
	    var p = new ltx.Element('presence', { from: stanza.attrs.to, to: stanza.attrs.from, id: stanza.attrs.id, type: 'error' });
	    p.c('x', { 'xmlns': XMLNS_MUC });
	    p.c('error', { by: myJid, type: 'modify' })
		.c('jid-malformed', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' });
	    xmppSend("presence error", p);
	    
	    xmppErrMes(stanza.attrs.from, "Unable to join room "+stanza.attrs.to+" because the jabber id was invalid (try another nickname).");
	    
	}
    }



    //--> message stanza
    if (stanza.is('message')) {
	var r;
	console.log("   INCOMING MESSAGE ");
	if (( r = stanza.attrs.to.match(JABBER_ID_REGEX2) )) {

	    var irc = getIRCConnection(bareJid, r[1]);
	    
	    console.log("   TO(regexResult):",""+r, "FROM:",stanza.attrs.from);
	    if (!irc) return;
	    
	    // if it is a valid room member, decide on the child tags

	    if (irc.chanData && ( error = stanza.getChild('error') )) {
		// throw out ghost users

		//delete irc.conn.sendTo[stanza.attrs.from];

	    } else if (irc.chanData && stanza.type == "groupchat") {
		if (( body = stanza.getChild('body') )) {
		    // pass along regular messages

		    var messageText = stanza.getChildText('body');
		    if (messageText == "") return;

		    irc.conn.client.say(irc.chan, messageText);
		    
		    sendIRCMessageToXMPP(irc.network, irc.conn, irc.conn.nick, irc.chan, messageText, stanza.attrs.id);

		} else if (( subject = stanza.getChild('subject') )) {
		    // room subject changes
		    //setRoomTopic(r[1], user.nick, stanza.getChildText('subject'));
		    irc.conn.client.send("TOPIC", irc.chan, stanza.getChildText('subject'));

		}
	    } else {
		var messageText = stanza.getChildText('body');
                if (!messageText) return;
		irc.conn.client.say(irc.chan, messageText);
	    }

	}
    }
    
  
}

function getIRCConnection(stanza_joinerJid, stanza_room) {
    var user = config.users[stanza_joinerJid];
    if (!user) return null;
    var roomParts = stanza_room.split(/_/);console.log(roomParts);
    if (roomParts.length != 2) {
	return null;
    }
    var netw = user.connections[roomParts[0]];
    if (!netw) return null;
    var chanData = netw.client.chanData(roomParts[1]);
    //if (!chanData) return null;
    return { conn: netw, network: roomParts[0], chan: roomParts[1], chanData: chanData };
}


function xmppJoinRoom(stanza_room, stanza_roomHost, stanza_roomNick, stanza_joinerJid, historyChild, passwdProvided, awayState) {
    var bareJid = stanza_joinerJid.replace(/\/.*$/, "");
    var irc = getIRCConnection(bareJid, stanza_room);
    var rprefix = stanza_room+'@'+stanza_roomHost+'/';
    if (!irc || !irc.chanData) {
	var p = xmppPresenceError(rprefix+stanza_roomNick, stanza_joinerJid, 'cancel', 'not-allowed');
        xmppSend("presence error - invalid room", p);
        return;
    }

    for(var i in irc.chanData.users) {
	xmppSendPresence(rprefix+i, stanza_joinerJid, 'member', 'participant', null, null, null, null);
    }
    var p = new ltx.Element('presence', { from: rprefix+irc.conn.nick, to: stanza_joinerJid, id: stanza_joinerJid });
    p.c('x', { xmlns: XMLNS_MUC + '#user' })
	.c('item', { affiliation: 'member', role: 'participant', jid: stanza_joinerJid }).up()
	.c('status', { code: '110' }).up() // references the user itself
	.c('status', { code: '100' }).up() // non-anonymous
	.c('status', { code: '170' }).up() // room is logged
	.c('status', { code: '210' });     // joined the room
    if(awayState) p.c('show').t(awayState);

    xmppSend("self presence stanza:",p);
    irc.conn.sendTo[stanza_joinerJid] = true;
}





//--> XMPP XML Helpers


function xmppSendPresence(from, to, affil, role, type, status, fromJid, xmppShow, xmppStatus) {
  var p = new ltx.Element('presence', { from: from, to: to, id: randId() });
  if (type) p.attrs.type = type;
  var x = p.c('x', { xmlns: XMLNS_MUC + '#user' });
  x.c('item', { affiliation: affil, role: role, jid: fromJid });
  if(status) {
    for(var i=0; i<status.length; i++) x.c('status', { code: status[i] });
  }
  if (xmppShow) p.c('show').t(xmppShow);
  if (xmppStatus) p.c('status').t(xmppStatus);
  else if (fromJid) p.c('status').t(getUserInfo(fromJid, "statusMessage"));
  xmppSend("xmppSendPresence", p);
}

function xmppMessage(room, nick, to, body, msgid, ts) {
  if(!msgid) msgid=randId();
  var msg = new ltx.Element('message', { type: 'groupchat', from: room+'@'+myJid+'/'+nick, to: to, id: msgid });
  if (body) msg.c('body').t(body);
  
  // non-standard timestamp element, as seen on http://mail.jabber.org/pipermail/standards/2010-October/023918.html
  // to avoid doubled messages in miniConf because of time differences of few seconds between server + client
  msg.c('x', { xmlns: 'jabber:x:tstamp', tstamp: new Date(ts).toISOString() });
  
  return msg;
}

function xmppSubjectMessage(room, bynick, to, subject, msgid) {
  if(!msgid) msgid=randId();
  var msg = new ltx.Element('message', { type: 'groupchat', from: room+'@'+myJid+'/'+bynick, to: to, id: msgid });
  msg.c('subject').t(subject);
  return msg;
}

function xmppErrMes(to, body) {
  var msg = new ltx.Element('message', { from: myJid, to: to });
  msg.c('body').t(body);
  xmppSend("ERR MES SEND:", msg);
}


function xmppPresenceError(from, to, errorType, errorCondition) {
  var p = new ltx.Element('presence', { from: from, to: to,  type: 'error' });
  p.c('x', { 'xmlns': XMLNS_MUC });
  p.c('error', { by: myJid, type: errorType })
    .c(errorCondition, { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' });
  return p;
}

function discoReply(stanza, query) {
  var disco = new ltx.Element('iq', 
                               { type: 'result', from: myJid, to: stanza.attrs.from, id: stanza.attrs.id });
  disco.c('query', { xmlns: query && query.attrs.xmlns });
  return disco;
}


function xmppSend(debug, msg) {
  console.log(" > "+debug, "\t", msg.toString());
  component.send(msg);
}


function randId() {
  return Math.floor(Math.random()*10000000)+1000000;
}







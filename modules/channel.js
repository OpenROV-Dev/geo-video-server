var zmq				= require('zmq');
var EventEmitter    = require('events').EventEmitter;
var util            = require('util');

var Channel = function( camera, channelNum )
{
	EventEmitter.call(this);
	var self 			= this;
	
	var channelPostfix	= camera.offset + "_" + channelNum;
	var server			= camera.deps.server;
	var plugin			= camera.deps.plugin;
	var defaults 		= camera.deps.defaults;
	
	var log       	= require('debug')( 'channel' + channelPostfix + ':log' );
    var error		= require('debug')( 'channel' + channelPostfix + ':error' );

	var videoStarted	= false;
	var beaconTimer 	= null;

	var videoEndpoint	= "ipc:///tmp/geomux_video" + camera.offset + "_" + channelNum + ".ipc";
	var eventEndpoint	= "ipc:///tmp/geomux_event" + camera.offset + "_" + channelNum + ".ipc";

	this.initFrame 		= {};
	this.settings		= {};
	this.api			= {};
	
	this.announcementInterval = {};
	this.healthInterval	= {};

	// Create video socket
	var videoSocket		= require('socket.io')(server,{origins: '*:*',path:defaults.wspath + channelPostfix });
	
	// Set up api event listener
	var apiSub = zmq.socket( 'sub' );
	apiSub.connect( eventEndpoint );
	apiSub.subscribe( "api" );
	
	// Set up settings event listener
	var settingsSub = zmq.socket( 'sub' );
	settingsSub.connect( eventEndpoint );
	settingsSub.subscribe( "settings" );
	
	// Set up health event listener
	var healthSub = zmq.socket( 'sub' );
	healthSub.connect( eventEndpoint );
	healthSub.subscribe( "health" );
	
	// Set up status event listener
	var statusSub = zmq.socket( 'sub' );
	statusSub.connect( eventEndpoint );
	statusSub.subscribe( "status" );
	
	// Set up error event listener
	var errorSub = zmq.socket( 'sub' );
	errorSub.connect( eventEndpoint );
	errorSub.subscribe( "error" );
	
	// Set up video data subscribers
	var initFrameSub = zmq.socket( 'sub' );
	initFrameSub.connect( videoEndpoint );
	initFrameSub.subscribe( "i" );
	
	var dataFrameSub = zmq.socket( 'sub' );
	dataFrameSub.connect( videoEndpoint );
	dataFrameSub.subscribe( "v" );
	
	// -------------------
	// Event listeners
    this.on( "command", function( command, params )
    {
		SendChannelCommand( command, params );
    } );
	
	errorSub.on( 'message', function( topic, data )
    {
		error( "Channel error: " + data );
	} );
	
	statusSub.on( 'message', function( topic, data )
    {
		log( "Channel status: " + data );
	} );
	
	apiSub.on( 'message', function( topic, data )
    {
		var api = JSON.parse( data );
		
		// Update our local api
		self.api = api;
		
		// Report the API to plugin
		plugin.emit( "geomux.channel.api", camera.offset, channelNum, self.api );
		
		// TODO: Load stored settings for this camera, or load them from currently selected settings profile in cockpit
		// Set some initial settings
		ApplySettings(
		{
			"bitrate": 		{ "value": 10000000 },
			"goplen": 		{ "value": 10 },
			"pict_timing": 	{ "enabled": true },
			"vui":			{ "enabled": true }
		}
		); 
		
		// Now that we have the API, we can start the video
		// TODO: Have plugin tell us when to start
		SendChannelCommand( "video_start" );
	} );

	settingsSub.on( 'message', function( topic, data )
    {
		var settings = JSON.parse( data );
			
		// Update our local settings store
		for(var setting in settings )
		{
			self.settings[ setting ] = settings[ setting ];
		}
     
	 	// Report the settings to plugin
		plugin.emit( "geomux.channel.settings", camera.offset, channelNum, self.settings );
	} );
	
	healthSub.on( 'message', function( topic, data )
    {
		// Report health stats to plugin
		plugin.emit( "geomux.channel.health", camera.offset, channelNum, JSON.parse( data ) );
	} );
	
	// Register to video data
	dataFrameSub.on( 'message', function( topic, data )
	{
		//log( "Packet received: " + data.length );
		
		// Forward packets over socket.io
		videoSocket.compress(false).volatile.emit( 'x-h264-video.data', data );
	} );
	
	// Listen for the init frame
	initFrameSub.on( 'message', function( topic, ftype ,moov )
    {

		self.ftypeBox = ftype;
		self.moovBox = moov;
		
        	var data = new Uint8Array(ftype.byteLength + moov.byteLength);
        	data.set(new Uint8Array(ftype), 0);
        	data.set(new Uint8Array(moov), ftype.byteLength);		
		self.initFrame = data;	
		
		log( "Channel status: Got init frame" );
		
		// Handle connections
		videoSocket.on('connect',function(client)
		{
			log( "Channel status: New video connection" );
			
			client.on('request_Init_Segment', function(fn) 
			{
				fn( new Buffer( self.initFrame, 'binary' ) );
			});
		});

		// Announce video source as json object on stderr
        var announcement = 
		{ 
			service:	'geomux',
			port:		defaults.port,
			addresses:	['127.0.0.1'],
			txtRecord:
			{
				resolution: 		self.settings.width.value.toString() + "x" + self.settings.height.value.toString(),
				framerate: 			self.settings.framerate.value,
				videoMimeType: 		'video/mp4',
				cameraLocation: 	camera.location,
				relativeServiceUrl: defaults.url,  
				wspath: 			defaults.wspath + channelPostfix
			}
		};
		
		plugin.emit( "geomux.video.announcement", camera.offset, channelNum, announcement );
		log( "Channel Announcement: " + JSON.stringify( announcement ) );
		
		// Announce camera endpoint every 5 secs
        self.announcementInterval = setInterval( function()
		{
			log( "Channel Announcement: " + JSON.stringify( announcement ) );
			plugin.emit( "geomux.video.announcement", camera.offset, channelNum, announcement );
		}, 5000 );
		
		// Emit init frame as part of the h264 data stream to allow for re-init of existing clients in the browser
		videoSocket.compress(false).volatile.emit( 'x-h264-video.data', data );
	} );
	
	// ----------------
	// Intervals
	
	// Ask geomuxpp for health reports every 5 secs
	this.healthInterval = setInterval( function()
	{
		SendChannelCommand( "report_health" );
	}, 5000 );
	
	// Cleanup function
	this.Cleanup = function()
	{
		console.log( "channel cleanup" );

		self.removeAllListeners();
		dataFrameSub.removeAllListeners();
		initFrameSub.removeAllListeners();
		errorSub.removeAllListeners();
		statusSub.removeAllListeners();
		settingsSub.removeAllListeners();
		apiSub.removeAllListeners();

		clearInterval( self.announcementInterval );
		clearInterval( self.healthInterval );
	}

	// ----------------
	// Helper functions
	
	function SendChannelCommand( command, params )
	{
		if( params === undefined )
		{
			params = "";
		}
		
		// Send channel command over zeromq to geomuxpp
		camera.commandPub.send( 
		[ 
			"cmd",
			JSON.stringify(
			{
				cmd: 	"chCmd",
				ch: 	channelNum,
				chCmd: 	command,
				params: params
			} )
		] );
	};
	
	function ApplySettings( settings )
	{
		if( settings === undefined )
		{
			return;
		}
		
		// Apply settings to channel
		SendChannelCommand( "apply_settings", { "settings": settings } );
	};
};
util.inherits(Channel, EventEmitter);

module.exports = function( camera, channelNum ) 
{
  	return new Channel( camera, channelNum );
};

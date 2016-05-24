var zmq				= require('zmq');
var EventEmitter    = require('events').EventEmitter;
var util            = require('util');

var Channel = function( camera, channelNum )
{
	EventEmitter.call(this);
	var self 			= this;
	
	var channelPostfix	= camera.offset + "_" + channelNum;
	var plugin			= camera.deps.plugin;
	var defaults 		= camera.defaults;

	var videoStarted	= false;
	var beaconTimer 	= null;

	var videoEndpoint	= "ipc:///tmp/geomux_video" + cameraOffset + "_" + channelNum + ".ipc";
	var eventEndpoint	= "ipc:///tmp/geomux_event" + cameraOffset + "_" + channelNum + ".ipc";

	this.initFrame 		= {};
	this.settings		= {};
	this.api			= {};

	// Create video socket
	var videoSocket		= require('socket.io')( defaults.port, { path: defaults.wspath + channelPostfix + "_video" } );
	
	// Set up api event listener
	var apiSub = zmq.socket( 'sub' );
	apiSub.connect( eventEndpoint );
	apiSub.subscribe( "api" );
	
	// Set up settings event listener
	var settingsSub = zmq.socket( 'sub' );
	settingsSub.connect( eventEndpoint );
	settingsSub.subscribe( "settings_update" );
	
	// Set up health event listener
	var healthSub = zmq.socket( 'sub' );
	healthSub.connect( eventEndpoint );
	healthSub.subscribe( "health" );
	
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
	
	apiSub.on( 'message', function( topic, data )
    {
		var api = JSON.parse( data );
		
		// Report the API to plugin
		plugin.emit( "geomux.channel.api", camera.offset, channelNum, api );
		
		// Update our local api
		self.api = api;
		
		// TODO: Load stored settings for this camera, or load them from currently selected settings profile in cockpit
		// Set some initial settings
		SendChannelCommand( "apply_settings", 
		{
			"bitrate": 		{ "value": 2000000 },
			"goplen": 		{ "value": 10 },
			"pict_timing": 	{ "enabled": true },
			"vui":			{ "enabled": true },
		} ); 
		
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
		plugin.emit( "geomux.channel.settings", camera.offset, channelNum, settings );
		
		// Store the current settings locally
		self.settings = settings;
	} );
	
	healthSub.on( 'message', function( topic, data )
    {
		// Report health stats to plugin
		plugin.emit( "geomux.channel.settings", camera.offset, channelNum, JSON.parse( data ) );
	} );
	
	// Listen for the init frame
	initFrameSub.on( 'message', function( topic, data )
    {
		self.initFrame = data;
		
		// Handle connections
		videoSocket.on('connect',function(client)
		{
			client.on('request_Init_Segment', function(fn) 
			{
				fn( new Buffer( self.initFrame, 'binary' ) );
			});
		});
		
		// Register to video data
		dataFrameSub.on( 'message', function( topic, data )
		{
			// Forward packets over socket.io
			videoSocket.compress(false).volatile.emit( 'x-h264-video.data', data );
		} );
		
		// Announce video source as json object on stderr
        var announcement = 
		{ 
			service:	'geomux',
			port:		defaults.port,
			addresses:	['127.0.0.1'],
			txtRecord:
			{
				resolution: 		self.settings.width.toString() + "x" + self.settings.height.toString(),
				framerate: 			self.settings.framerate,
				videoMimeType: 		'video/mp4',
				cameraLocation: 	defaults.location,
				relativeServiceUrl: defaults.url,  
				wspath: 			defaults.wspath + channelPostfix + "_video"
			}
		};
		
		plugin.emit( "geomux.channel.announcement", camera.offset, channelNum, announcement );
		
		// Create interval timer
        if( beaconTimer !== null )
		{
			clearInterval( beaconTimer );
        }
		
		// Announce camera endpoint every 5 secs
        setInterval( function()
		{
			plugin.emit( "geomux.channel.announcement", camera.offset, channelNum, announcement );
		}, 5000 );
	} );
	
	// ----------------
	// Intervals
	
	// Ask geomuxpp for health reports every 5 secs
	setInterval( function()
	{
		SendChannelCommand( "report_health" );
	}, 5000 );
	
	// ----------------
	// Helper functions
	
	function SendChannelCommand( command, params )
	{
		// Send channel command over zeromq to geomuxpp
		camera.commandPublisher.send( 
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
};
util.inherits(Channel, EventEmitter);

module.exports = function( camera, channelNum ) 
{
  	return new Channel( camera, channelNum );
};
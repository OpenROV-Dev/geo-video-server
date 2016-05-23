var zmq				= require('zmq');
var EventEmitter    = require('events').EventEmitter;
var util            = require('util');

var Channel = function( camera, channelNum )
{
	EventEmitter.call(this);
	
	var self 		= this;
	this.camera 	= camera;
	this.cameraNum 	= parseInt( camera.offset );
	this.channelNum = channelNum;
	this.initFrame 	= {};
	this.settings	= {};
	
	this.videoEndpoint	= "ipc:///tmp/geomux_video" + camera.offset + "_" + channelNum + ".ipc";
	this.eventEndpoint	= "ipc:///tmp/geomux_event" + camera.offset + "_" + channelNum + ".ipc";
	
	var beaconTimer = null;
	
	// Generate a port number for this channel
	this.portNum 	= 8099 + ( 10 * this.cameraNum ) + this.channelNum;
	this.io 		= require('socket.io')( this.portNum );
	
	// Set up event listener
	var apiSub = zmq.socket( 'sub' );
	apiSub.connect( this.eventEndpoint );
	apiSub.subscribe( "api" );
	
	// Listen for the init frame
	apiSub.on( 'message', function( topic, data )
    {
		// Finally, tell the daemon to start this channel
		var command = 
		{
			cmd: "chCmd",
			ch: self.channelNum,
			chCmd: "video_start",
			params: ""
		};

		console.log( "start" );
		self.camera.commandPublisher.send( [ "cmd", JSON.stringify( command ) ] );
	} );
	
	// Set up event listener
	var settingsSub = zmq.socket( 'sub' );
	settingsSub.connect( this.eventEndpoint );
	settingsSub.subscribe( "settings_update" );
	
	// Listen for the init frame
	settingsSub.on( 'message', function( topic, data )
    {
		console.log( "Got channel settings on: " + self.channelNum );
		
		var settings = JSON.parse( data );

		for(var setting in settings )
		{
			console.log( "updating setting: " + setting );
			self.settings[ setting ] = settings[ setting ];
		}
     
		// Wrap with a message type
		var channelSettings = JSON.stringify( 
		{ 
			type: "ChannelSettings",
			channel: self.channelNum,
			payload: settings
		} );
		
		// Report settings to cockpit
		console.error( channelSettings );
		
		// Store the current settings locally
		self.channels[ settings.chNum ].settings = settings.settings;
	} );
	
	// Set up event listener
	var healthSub = zmq.socket( 'sub' );
	healthSub.connect( this.eventEndpoint );
	healthSub.subscribe( "health" );
	
	// Listen for the health messages
	healthSub.on( 'message', function( topic, data )
    {
		console.log( "Got health on: " + self.channelNum );
		
		var health = JSON.parse( data );
     
		// Wrap with a message type
		var jHealth = JSON.stringify( 
		{ 
			type: "ChannelHealth",
			channel: self.channelNum,
			payload: settings
		} );
		
		// Report settings to cockpit
		console.error( channelSettings );
		
		// Store the current settings locally
		self.channels[ settings.chNum ].settings = settings.settings;
	} );
	
	setInterval( function()
	{
		// Finally, tell the daemon to start this channel
		var command = 
		{
			cmd: "chCmd",
			ch: self.channelNum,
			chCmd: "report_health",
			params: ""
		};

		self.camera.commandPublisher.send( [ "cmd", JSON.stringify( command ) ] );
	}, 5000 );
	
	// Set up video data subscribers
	var initFrameSub = zmq.socket( 'sub' );
	initFrameSub.connect( this.videoEndpoint );
	initFrameSub.subscribe( "i" );
	
	var dataFrameSub = zmq.socket( 'sub' );
	dataFrameSub.connect( this.videoEndpoint );
	dataFrameSub.subscribe( "v" );
	
	// Listen for the init frame
	initFrameSub.on( 'message', function( topic, data )
    {
		self.initFrame = data;
		
		// Handle connections
		self.io.on('connect',function(client)
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
			self.io.compress(false).volatile.emit( 'x-h264-video.data', data );
		} );
		
		// Announce video source as json object on stderr
        var announcement = 
		{ 
			type: "ChannelAnnouncement",
			channel: self.channelNum,
			payload:
			{
				service:	'geomux',
				port:		self.portNum,
				addresses:	['127.0.0.1'],
				txtRecord:
				{
					resolution: 		self.settings.width.toString() + "x" + self.settings.height.toString(),
					framerate: 			self.settings.framerate,
					videoMimeType: 		'video/mp4',
					cameraLocation: 	"forward",
					relativeServiceUrl: ':' + self.portNum + '/'
				}
			}
		};
		
        var jannouncement = JSON.stringify( announcement );
		
        console.error( jannouncement );
		
		// Create interval timer
        if( beaconTimer !== null )
		{
          clearInterval( beaconTimer );
        }
		
		// Announce camera endpoint every 5 secs
        setInterval( function()
		{
            console.error( jannouncement );
        }, 5000 );
	} );
	
	
    // Channel settings
    channelSettingsSub.on( 'message', function( topic, msg )
    {
        
    } );
};
util.inherits(Channel, EventEmitter);

module.exports = function( camera, channelNum, endpoint ) 
{
  	return new Channel( camera, channelNum, endpoint );
};
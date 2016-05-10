var events 	= require('events');  
var zmq		= require('zmq');

var Channel = function( camera, channelNum, endpoint )
{
	var self 		= this;
	this.camera 	= camera;
	this.cameraNum 	= parseInt( camera.cameraNumber );
	this.channelNum = channelNum;
	this.endpoint	= endpoint;
	this.initFrame 	= {};
	this.settings	= {};
	
	var beaconTimer = null;
	
	// Generate a port number for this channel
	this.portNum 	= 8099 + ( 10 * this.cameraNum ) + this.channelNum;
	this.io 		= require('socket.io')( this.portNum );
	
	// Set up video data subscribers
	var initFrameSub = zmq.socket( 'sub' );
	initFrameSub.connect( this.endpoint );
	initFrameSub.subscribe( "i" );
	
	var dataFrameSub = zmq.socket( 'sub' );
	dataFrameSub.connect( this.endpoint );
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
			type: "CameraAnnouncement",
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
	
	// Finally, tell the daemon to start this channel
	var command = 
	{
		cmd: "chCmd",
		ch: self.channelNum,
		chCmd: "video_start",
		value: ""
	};
	
	self.camera.commandPublisher.send( [ "cmd", JSON.stringify( command ) ] );
};

Channel.prototype.__proto__ = events.EventEmitter.prototype;

module.exports = function( camera, channelNum, endpoint ) 
{
  	return new Channel( camera, channelNum, endpoint );
};
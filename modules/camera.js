var zmq		= require('zmq');

var Camera = function( cameraOffset )
{
    var self            = this;
    this.cameraNumber   = cameraOffset;
    this.channels       = {};
    
    // Helper function
    var GetCamChannelString = function( channelNum )
    {
        return ( "[" + self.cameraNumber + "][" + channelNum + "]: " );
    };
    
    /////////////
    // Set up channel status subscribers
    this.commandPublisher   = zmq.socket( 'pub' );  // Sends commands to geomuxpp
    
    var channelRegSub       = zmq.socket( 'sub' );  // Listen for channel registrations
    var channelSettingsSub  = zmq.socket( 'sub' );  // Listen for channel settings updates
    var channelHealthSub    = zmq.socket( 'sub' );  // Listen for channel health updates
    
    // Connect ZMQ sockets
    this.commandPublisher.connect( "ipc:///tmp/geomux_command" + self.cameraNumber + ".ipc" );
    channelRegSub.connect( "ipc:///tmp/geomux_status" + self.cameraNumber + ".ipc" );
    channelSettingsSub.connect( "ipc:///tmp/geomux_status" + self.cameraNumber + ".ipc" );
    channelHealthSub.connect( "ipc:///tmp/geomux_status" + self.cameraNumber + ".ipc" );
    
    // Subscribe to messages
    channelRegSub.subscribe("channel_registration");
    channelSettingsSub.subscribe("channel_settings");
    channelHealthSub.subscribe("channel_health");
    /////////////
   
    // Channel registrations
    channelRegSub.on( 'message', function( topic, msg )
    {
        var registration = JSON.parse( msg );

        if( registration.status == true )
        {
            console.log( "Channel announced " + GetCamChannelString( registration.chNum ) + registration.endpoint );
            
            // Create a channel object
            self.channels[ registration.chNum ] = require( "channel.js" )( self, registration.chNum, registration.endpoint );
        }
        else
        {
            console.log( "Channel closed " + GetCamChannelString( registration.chNum ) );
            
            // Remove the channel object
            self.channels[ registration.chNum ] = undefined;
        }
    } );
    
    // Channel settings
    channelSettingsSub.on( 'message', function( topic, msg )
    {
        var settings = JSON.parse( msg );
       
        if( self.channels[ settings.chNum ] === undefined )
        {
            console.log( "Settings received for non-existent channel" );
        }
        else
        {
            console.log( "Got channel settings " + GetCamChannelString( settings.chNum ) );
            
            // Wrap with a message type
            var channelSettings = JSON.stringify( 
            { 
                type: "ChannelSettings",
                payload: settings
            } );
            
            // Report settings to cockpit
            console.error( channelSettings );
            
            // Store the current settings locally
            self.channels[ settings.chNum ].settings = settings.settings;
        }
    } );
    
    // Channel health
    channelHealthSub.on( 'message', function( topic, msg )
    {
        var health = JSON.parse( msg );
        
        if( self.channels[ health.chNum ] === undefined )
        {
            console.log( "Health received for non-existent channel" );
        }
        else
        {
            console.log( "Got channel health " + GetCamChannelString( health.chNum ) );
            
            // Wrap with a message type
            var healthStatus = JSON.stringify( 
            { 
                type: "ChannelHealth",
                payload: JSON.parse( msg )
            } );
            
            // Report health to cockpit
            console.error( healthStatus );
            
            // Store the current settings locally
            self.channels[ health.chNum ].health = health.stats;
        }
    } );
    
    // Set up timer to request health every 5 secs
    setInterval( function()
    {
        Object.keys( self.channels ).forEach( function(key, index)
        {
            // Send command to request health status update
            var command = 
            {
                cmd: "chCmd",
                ch: self.channels[ index ].channelNum,
                chCmd: "publish_health",
                value: ""
            };
            
            self.commandPublisher.send( [ "cmd", JSON.stringify( command ) ] );
        } );
    }, 5000 );
};

module.exports = function( cameraOffset ) 
{
    return new Camera( cameraOffset );
};
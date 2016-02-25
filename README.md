Not for general use yet. Streaming of particular uvc cameras over socket.io

This project is responsible for serving the h264 stream from the geo camera via socket.io.

It first tries to init the camera:
1. Use mxcam whois to see if the camera has been booted.
2. If needed, boot the camera with mxcam
3. Find the video device(s) matching the camera
 - /dev/v4l/by-id/usb-GEO_Semi_Condor_12345-video-index0 is a symlink to the /dev/video#
 or
 sudo udevadm info --query=all --name=/dev/video1
4. Stream the video

Dependencies.
Use scripts to load Dependencies
 - apt get the geo-driver


License: All Rights Reservered
Still working out the open source license for this package.

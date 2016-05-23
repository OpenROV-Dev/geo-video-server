#!/bin/bash

if [ -f /.need-depmod ]
then
  modprobe -r uvcvideo || true
  depmod -a
  modprobe uvcvideo
  rm /.need-depmod
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
geoCameraFound=$(mxcam list | grep -q 'device #1')

if ! $geoCameraFound
then
    echo 'No Geo Camera found'
    exit 1004
fi

mxcam whoami | grep -q 'Waiting for USB boot'
awaitingBoot=$?
if [ $awaitingBoot -eq 0 ]
then
    echo 'Booting camera'
    mxcam boot $DIR/../../firmware/gc6500_ddrboot_fw.gz.img $DIR/../../geoconf/ov4689_H264_1080p30.json
    
    sleep 5
    
    # TODO: Wait until booted
    echo 'Camera booted'
else
    echo 'Camera already booted'
    # mxcam bootmode | grep -qc 'snor'
    
    # sleep 1
    # bootmodesnor=$?
    # if [ $bootmodesnor -eq 0 ]
    # then
    #   echo 'Camera is factor SNOR mode, changing to USB boot'
    #  mxcam flash --bootloader --silent $DIR/../../firmware/gc6500_btld_ddrboot_534_epwr.rom
     
    #  sleep 1
    #  mxcam boot $DIR/../../firmware/gc6500_ddrboot_fw.gz.img $DIR/../../geoconf/ov4689_H264_1080p30.json
    #  sleep 1
    # fi
fi

#TODO: Move these in to the configuration files.
mxuvc bitrate 10000000
mxuvc gop 10

#!/bin/bash
echo "--------------"
echo "BOOTING GC6500"

if [ -f /.need-depmod ]
then
    echo "Loading kernel modules..."
    modprobe -r uvcvideo || true
    depmod -a
    modprobe uvcvideo
    rm /.need-depmod
    echo "Kernel modules loaded."
fi

echo "Detecting camera..."

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
geoCameraFound=$(mxcam list | grep -q 'device #1')

if ! $geoCameraFound
then
    echo "No Geo Camera found"
    exit 1004
fi

echo "Detected camera."
echo "Checking camera status..."

mxcam whoami | grep -q "Waiting for USB boot"
awaitingBoot=$?

if [ $awaitingBoot -eq 0 ]
then
    echo "Camera firmware not loaded."
    echo "Booting camera..."
    mxcam boot $DIR/../../firmware/gc6500_ddrboot_fw.gz.img $DIR/../../geoconf/ov4689_H264_1080p30.json
    sleep 5
    
    echo "Camera booted."
else
    echo "Camera already booted."
    
    echo "Checking if camera is in SNOR mode..."
    mxcam bootmode | grep -qc 'snor'
    bootmodesnor=$?
    
    if [ $bootmodesnor -eq 0 ]
    then
        echo "Camera is in factory SNOR mode, changing to USB boot..."
        mxcam bootmode usb
        sleep 1
        mxcam flash --silent --bootloader $DIR/../../firmware/gc6500_btld_ddrboot_534_epwr.rom
        sleep 3
        mxcam reset
        sleep 3
        mxcam boot $DIR/../../firmware/gc6500_ddrboot_fw.gz.img $DIR/../../geoconf/ov4689_H264_1080p30.json
        echo "Camera booted in USB mode."
    fi
fi

echo "--------------"
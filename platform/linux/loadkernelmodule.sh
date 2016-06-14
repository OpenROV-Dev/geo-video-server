#!/bin/bash
set -ex

echo "--------------"
echo "Loading GC6500 uvcvideo kernel module..."

if [ -f /.need-depmod ]
then
    echo "Loading kernel modules..."
    modprobe -r uvcvideo || true
    depmod -a
    modprobe uvcvideo
    rm /.need-depmod
    echo "Kernel modules loaded."
    exit 0
else
    echo "Kernel module already loaded."
    exit 0
fi
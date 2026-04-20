#!/bin/bash

TARGET_URL="https://pal-k8s.bccdev.id/server-info"

echo "========================================================="
echo "TESTING LOAD BALANCER WITH STICKY SESSION"
echo "========================================================="

echo -e "\nTEST 1: Simulating 10 New Users (Without Cookie)"
echo "---------------------------------------------------------"
for i in {1..10}; do
    POD_NAME=$(curl -s $TARGET_URL | grep -o '"podName":"[^"]*"' | cut -d'"' -f4)
    echo "Request from User $i served by : $POD_NAME"
done

echo -e "\nTEST 2: Simulating 1 User Navigating (With Cookie)"
echo "---------------------------------------------------------"
curl -s -c cookie.txt $TARGET_URL > /dev/null

for i in {1..10}; do
    POD_NAME=$(curl -s -b cookie.txt $TARGET_URL | grep -o '"podName":"[^"]*"' | cut -d'"' -f4)
    echo "Click number $i served by      : $POD_NAME"
done

rm -f cookie.txt
echo -e "\nTesting Completed!"
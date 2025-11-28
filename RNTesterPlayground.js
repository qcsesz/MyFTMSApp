import React, { useState } from 'react';
import { View, Text, Button, FlatList } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

const manager = new BleManager();

export default function RNTesterPlayground() {
  const [devices, setDevices] = useState([]);
  const [connectedDevice, setConnectedDevice] = useState(null);

  const TACX_SERVICE = '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e';
  const TACX_NOTIFY = '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e';

  const scanDevices = () => {
	console.log('Scanning for BLE devices...');
	setDevices([]);
	manager.startDeviceScan(null, null, (error, device) => {
  	if (error) {
    	console.error('Scan error:', error);
    	return;
  	}
  	if (device && device.name) {
    	setDevices(prev => prev.some(d => d.id === device.id) ? prev : [...prev, device]);
  	}
	});
	setTimeout(() => manager.stopDeviceScan(), 5000);
  };

  const connectToDevice = async (device) => {
	try {
  	console.log('Connecting to', device.name);
  	const connected = await device.connect();
  	await connected.discoverAllServicesAndCharacteristics();
  	setConnectedDevice(connected);
  	console.log('Connected to', connected.name);
	} catch (err) {
  	console.error('Connection error:', err);
	}
  };

  const subscribeTacxNotify = async () => {
	if (!connectedDevice) {
  	console.warn('No device connected');
  	return;
	}
	try {
  	console.log('Subscribing to Tacx FE-C notify characteristic...');
  	connectedDevice.monitorCharacteristicForService(TACX_SERVICE, TACX_NOTIFY, (error, characteristic) => {
    	if (error) {
      	console.error('Monitor error:', error);
      	return;
    	}
    	if (characteristic?.value) {
      	console.log('Received value (base64):', characteristic.value);
    	}
  	});
	} catch (err) {
  	console.error('Subscribe error:', err);
	}
  };

  return (
	<View style={{ padding: 20 }}>
  	<Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>RNTester Playground - BLE Crash Repro</Text>
  	<Button title="Scan Devices" onPress={scanDevices} />
  	<FlatList
    	data={devices}
    	keyExtractor={(item) => item.id}
    	renderItem={({ item }) => (
      	<Button title={`Connect to ${item.name}`} onPress={() => connectToDevice(item)} />
    	)}
  	/>
  	<Button title="Subscribe Tacx FE-C Notify" onPress={subscribeTacxNotify} />
	</View>
  );
}


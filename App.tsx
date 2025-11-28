import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, Button, FlatList, TouchableOpacity, StyleSheet,
  PermissionsAndroid, Platform, ActivityIndicator, TextInput
} from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Picker } from '@react-native-picker/picker';
import { Buffer } from 'buffer';

const manager = new BleManager();

/** Short UUIDs (lowercase) used for matching inside full 128-bit UUIDs */
const FTMS_SERVICE = '1826';
const INDOOR_BIKE_DATA = '2ad2';
const CSCS_SERVICE = '1816';
const CSC_MEASUREMENT = '2a5b';
const CPS_SERVICE = '1818';
const CYCLING_POWER_MEASUREMENT = '2a63';

/** Tacx FE-C tunnel (full UUIDs, lowercase) */
const TACX_SERVICE = '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e';
const TACX_WRITE   = '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e';
const TACX_NOTIFY  = '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e';

const wheelSizes = [
  { label: '700c (Road)', diameter: 0.7 },
  { label: '29" MTB', diameter: 0.736 },
  { label: '27.5" MTB', diameter: 0.698 },
  { label: '26" MTB', diameter: 0.66 }
];

type GattInfo = { service: string; characteristics: string[] };

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);

  // Metrics
  const [speed, setSpeed] = useState<number>(0);
  const [cadence, setCadence] = useState<number>(0);
  const [distance, setDistance] = useState<number>(0); // FTMS field
  const [resistance, setResistance] = useState<number>(0); // FTMS field
  const [power, setPower] = useState<number>(0);

  // UI inputs
  const [wheelDiameter, setWheelDiameter] = useState<number>(0.7);
  const [targetPower, setTargetPower] = useState<string>('150');
  const [slope, setSlope] = useState<string>('5');

  // System state
  const [isConnecting, setIsConnecting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [gattInfo, setGattInfo] = useState<GattInfo[]>([]);
  const [hasFTMS, setHasFTMS] = useState<boolean>(false);
  const [hasTacx, setHasTacx] = useState<boolean>(false);
  const [hasCSCS, setHasCSCS] = useState<boolean>(false);
  const [hasCPS, setHasCPS] = useState<boolean>(false);

  // ÚJ: Tacx előfeltétel-kész állapot (mindkét char megvan és eszköz csatlakoztatva)
  const [tacxReady, setTacxReady] = useState<boolean>(false);

  // Debug
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const logDebug = (msg: string) => {
	const timestamp = new Date().toLocaleTimeString();
	setDebugLogs(prev => [`[${timestamp}] ${msg}`, ...prev.slice(0, 49)]);
  };

  // For CSC deltas
  const lastCSC = useRef<{ wheelRev?: number; wheelTime?: number; crankRev?: number; crankTime?: number }>({});

  // Keep track of live subscriptions to cleanly unsubscribe
  const subsRef = useRef<Subscription[]>([]);

  // Lifecycle hook
  useEffect(() => {
	requestPermissions().then((granted) => {
  	if (granted) scanDevices();
	});
	// Cleanup
	return () => {
  	try { manager.stopDeviceScan(); } catch {}
  	subsRef.current.forEach(s => { try { s.remove(); } catch {} });
  	subsRef.current = [];
  	if (connectedDevice) {
    	manager.cancelDeviceConnection(connectedDevice.id).catch(() => {});
  	}
	};
  }, []);

  const requestPermissions = async (): Promise<boolean> => {
	if (Platform.OS === 'android') {
  	try {
    	const granted = await PermissionsAndroid.requestMultiple([
      	PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN as string,
      	PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT as string,
      	PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION as string,
    	]);
    	const allGranted = Object.values(granted).every(result => result === PermissionsAndroid.RESULTS.GRANTED);
    	if (allGranted) {
      	logDebug('Permissions granted.');
      	return true;
    	} else {
      	logDebug('Not all permissions granted.');
      	setErrorMsg('Bluetooth engedélyek szükségesek.');
      	return false;
    	}
  	} catch (err: any) {
    	logDebug(`Permission error: ${err?.message ?? err}`);
    	setErrorMsg('Failed to request Bluetooth permissions.');
    	return false;
  	}
	}
	return true; // iOS/other
  };

  const scanDevices = () => {
	if (isScanning) return;
	setDevices([]);
	setErrorMsg(null);
	setIsScanning(true);
	logDebug('Scanning...');
	try {
  	manager.startDeviceScan(null, null, (error, device) => {
    	if (error) {
      	logDebug(`Scan error: ${error.message}`);
      	setIsScanning(false);
      	manager.stopDeviceScan();
      	return;
    	}
    	if (device?.name) {
      	setDevices(prev => prev.some(d => d.id === device.id) ? prev : [...prev, device]);
    	}
  	});
  	// stop after 5s
  	setTimeout(() => {
    	if (isScanning) {
      	manager.stopDeviceScan();
      	setIsScanning(false);
      	logDebug('Scan stopped by timeout.');
    	}
  	}, 5000);
	} catch (err: any) {
  	logDebug(`Start scan error: ${err?.message ?? err}`);
  	setErrorMsg('Failed to start BLE scan.');
  	setIsScanning(false);
	}
  };

  const disconnectDevice = useCallback(async () => {
	if (connectedDevice) {
  	try {
    	await connectedDevice.cancelConnection();
    	logDebug('Sikeresen lecsatlakozva.');
  	} catch {
    	logDebug('Lecsatlakozási hiba, de valószínűleg már megszakadt.');
  	}
  	// Állapotok visszaállítása
  	setConnectedDevice(null);
  	setHasFTMS(false);
  	setHasTacx(false);
  	setTacxReady(false);
  	setHasCSCS(false);
  	setHasCPS(false);
  	setGattInfo([]);
  	subsRef.current.forEach(s => { try { s.remove(); } catch {} });
  	subsRef.current = [];
	}
  }, [connectedDevice]);

  // Safe helpers from enumerated GATT
  const findServiceUuid = (shortOrFullLower: string): string | undefined => {
	const entry = gattInfo.find(s => s.service.includes(shortOrFullLower.toLowerCase()));
	return entry?.service;
  };
  const findCharacteristicUuid = (serviceLower: string, charShortOrFullLower: string): string | undefined => {
	const entry = gattInfo.find(s => s.service === serviceLower.toLowerCase());
	const match = entry?.characteristics.find(c => c.includes(charShortOrFullLower.toLowerCase()));
	return match;
  };

  // ÚJ: Tacx preflight ellenőrzés a szolgáltatás/karakterisztika meglétére
  const evaluateTacxReady = (info: GattInfo[]) => {
	const svc = info.find(s => s.service.includes(TACX_SERVICE));
	const hasWrite = !!svc?.characteristics.find(c => c.includes(TACX_WRITE));
	const hasNotify = !!svc?.characteristics.find(c => c.includes(TACX_NOTIFY));
	const ready = !!svc && hasWrite && hasNotify;
	setHasTacx(!!svc);
	setTacxReady(ready);
	logDebug(`Tacx preflight: service=${!!svc}, write=${hasWrite}, notify=${hasNotify}, ready=${ready}`);
  };

  const connectToDevice = async (device: Device) => {
	try { manager.stopDeviceScan(); setIsScanning(false); } catch {}
	if (connectedDevice?.id === device.id) return logDebug('Already connected.');
	if (isConnecting) return logDebug('Connection already in progress.');
	await disconnectDevice(); // előző eszköz tiszta bontása
	setIsConnecting(true);
	setErrorMsg(null);
	logDebug(`Connecting to ${device.name}...`);
	// Timeout 10s
	const connectTimeout = new Promise<Device>((_, reject) => {
  	setTimeout(() => reject(new Error('Connection timed out after 10s')), 10000);
	});

	try {
  	const connected = await Promise.race([device.connect(), connectTimeout]);
  	// Opcionális: MTU kérés (Androidon gyakran stabilabb write-okhoz)
  	try { await connected.requestMTU?.(185); logDebug('MTU requested: 185'); } catch {}
  	await connected.discoverAllServicesAndCharacteristics();
  	setConnectedDevice(connected);
  	logDebug(`Connected to ${connected.name}`);

  	const services = await connected.services();
  	const nextGatt: GattInfo[] = [];
  	await Promise.allSettled(
    	services.map(async (s) => {
      	try {
        	const chars = await connected.characteristicsForService(s.uuid);
        	nextGatt.push({ service: s.uuid.toLowerCase(), characteristics: chars.map(c => c.uuid.toLowerCase()) });
      	} catch {
        	nextGatt.push({ service: s.uuid.toLowerCase(), characteristics: [] });
      	}
    	})
  	);
  	setGattInfo(nextGatt);

  	// Capability detection
  	const ftms = nextGatt.some(s => s.service.includes(FTMS_SERVICE));
  	const cscs = nextGatt.some(s => s.service.includes(CSCS_SERVICE));
  	const cps  = nextGatt.some(s => s.service.includes(CPS_SERVICE));
  	setHasFTMS(ftms);
  	setHasCSCS(cscs);
  	setHasCPS(cps);

  	// Tacx FE-C előfeltételek
  	evaluateTacxReady(nextGatt);

  	// Automatikus lecsatlakozás esemény kezelése
  	connected.onDisconnected(() => {
    	logDebug('Device disconnected automatically');
    	disconnectDevice();
  	});
	} catch (error: any) {
  	logDebug(`Connection error: ${error?.message ?? error}`);
  	setErrorMsg(`Failed to connect: ${error?.message ?? 'Ismeretlen hiba'}`);
  	try { await device.cancelConnection(); } catch {}
	} finally {
  	setIsConnecting(false);
	}
  };

  /** ------- Manual subscriptions (only after you tap) ------- */
  const subscribeFTMS_IBD = async () => {
	if (!connectedDevice) return;
	const svc = findServiceUuid(FTMS_SERVICE);
	if (!svc) return logDebug('FTMS service not found in GATT');
	const ch = findCharacteristicUuid(svc, INDOOR_BIKE_DATA);
	if (!ch) return logDebug('FTMS Indoor Bike Data char not found in GATT');
	try {
  	const sub = connectedDevice.monitorCharacteristicForService(svc, ch, (error, characteristic) => {
    	if (error) { logDebug(`FTMS monitor error: ${error.message}`); return; }
    	if (characteristic?.value) {
      	try { parseFTMSData(Buffer.from(characteristic.value, 'base64')); }
      	catch (e: any) { logDebug(`FTMS parse error: ${e?.message ?? e}`); }
    	}
  	});
  	subsRef.current.push(sub);
  	logDebug('Subscribed to FTMS Indoor Bike Data');
	} catch (err: any) {
  	logDebug(`FTMS subscribe error: ${err?.message ?? err}`);
	}
  };

  const subscribeCSCS = async () => {
	if (!connectedDevice) return;
	const svc = findServiceUuid(CSCS_SERVICE);
	if (!svc) return logDebug('CSCS service not found');
	const ch = findCharacteristicUuid(svc, CSC_MEASUREMENT);
	if (!ch) return logDebug('CSC Measurement char not found');
	try {
  	const sub = connectedDevice.monitorCharacteristicForService(svc, ch, (error, characteristic) => {
    	if (error) { logDebug(`CSCS monitor error: ${error.message}`); return; }
    	if (characteristic?.value) {
      	try { parseCSCMeasurement(Buffer.from(characteristic.value, 'base64')); }
      	catch (e: any) { logDebug(`CSCS parse error: ${e?.message ?? e}`); }
    	}
  	});
  	subsRef.current.push(sub);
  	logDebug('Subscribed to CSCS Measurement');
	} catch (err: any) {
  	logDebug(`CSCS subscribe error: ${err?.message ?? err}`);
	}
  };

  const subscribeCPS = async () => {
	if (!connectedDevice) return;
	const svc = findServiceUuid(CPS_SERVICE);
	if (!svc) return logDebug('CPS service not found');
	const ch = findCharacteristicUuid(svc, CYCLING_POWER_MEASUREMENT);
	if (!ch) return logDebug('Cycling Power Measurement char not found');
	try {
  	const sub = connectedDevice.monitorCharacteristicForService(svc, ch, (error, characteristic) => {
    	if (error) { logDebug(`CPS monitor error: ${error.message}`); return; }
    	if (characteristic?.value) {
      	try { parseCPSMeasurement(Buffer.from(characteristic.value, 'base64')); }
      	catch (e: any) { logDebug(`CPS parse error: ${e?.message ?? e}`); }
    	}
  	});
  	subsRef.current.push(sub);
  	logDebug('Subscribed to CPS Measurement');
	} catch (err: any) {
  	logDebug(`CPS subscribe error: ${err?.message ?? err}`);
	}
  };

  const subscribeTacxNotify = async () => {
	if (!connectedDevice) return;
	const svc = findServiceUuid(TACX_SERVICE);
	if (!svc) return logDebug('Tacx service not found');
	const ch = findCharacteristicUuid(svc, TACX_NOTIFY);
	if (!ch) return logDebug('Tacx notify char not found');
	try {
  	const sub = connectedDevice.monitorCharacteristicForService(svc, ch, (error, characteristic) => {
    	if (error) { logDebug(`Tacx monitor error: ${error.message}`); return; }
    	if (characteristic?.value) {
      	try { parseTacxData(Buffer.from(characteristic.value, 'base64')); }
      	catch (e: any) { logDebug(`Tacx parse error: ${e?.message ?? e}`); }
    	}
  	});
  	subsRef.current.push(sub);
  	logDebug('Subscribed to Tacx FE-C notify');
	} catch (err: any) {
  	logDebug(`Tacx subscribe error: ${err?.message ?? err}`);
	}
  };

  /** ------- Tacx FE-C writes (ANT tunneling) ------- */

  // ANT+ XOR checksum helper for first 12 bytes
  const calculateChecksum = (buffer: Buffer): number => {
	let checksum = 0;
	for (let i = 0; i < buffer.length; i++) checksum ^= buffer[i];
	return checksum;
  };

  // ÚJ: Biztonságos, globálisan ellenőrzött write retry + delay
  const sendTacxCommand = async (payload8: Buffer, commandName: string, maxRetries = 3, delayMs = 200) => {
	// Globális előfeltétel: eszköz csatlakoztatva és Tacx preflight OK
	if (!connectedDevice || !tacxReady) {
  	logDebug(`Skipping ${commandName}: Tacx not ready (connected=${!!connectedDevice}, ready=${tacxReady})`);
  	return;
	}
	const svc = findServiceUuid(TACX_SERVICE);
	const writeChar = svc ? findCharacteristicUuid(svc, TACX_WRITE) : undefined;
	if (!svc || !writeChar) {
  	logDebug(`Skipping ${commandName}: Tacx service/char missing (svc=${!!svc}, write=${!!writeChar})`);
  	setTacxReady(false);
  	return;
	}

	// ANT+ keret felépítése (13 bájt)
	const antCommand = Buffer.alloc(13);
	antCommand.writeUInt8(0xA4, 0); // Sync
	antCommand.writeUInt8(0x09, 1); // Length (channel + payload)
	antCommand.writeUInt8(0x4F, 2); // Message ID (Acknowledged Data)
	antCommand.writeUInt8(0x05, 3); // Channel (fix, ha több csatorna kell, paraméterezd)
	payload8.copy(antCommand, 4);
	const checksum = calculateChecksum(antCommand.slice(0, 12));
	antCommand.writeUInt8(checksum, 12);

	const base64String = antCommand.toString('base64');
	logDebug(`Send prep [${commandName}]: ${antCommand.toString('hex')}`);

	// Retry ciklus
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
  	try {
    	logDebug(`WRITE attempt ${attempt}/${maxRetries}: ${commandName}`);
    	await connectedDevice.writeCharacteristicWithResponseForService(svc, writeChar, base64String);
    	logDebug(`WRITE success: ${commandName}`);
    	return;
  	} catch (bleError: any) {
    	const errMsg = bleError?.message ?? String(bleError);
    	logDebug(`WRITE error on attempt ${attempt}: ${commandName} -> ${errMsg}`);
    	setErrorMsg(`Tacx Parancs Hiba: ${errMsg}`);
    	// Ha GATT nem indítható, adj kis pihenőt, majd újra
    	if (attempt < maxRetries) {
      	await new Promise(res => setTimeout(res, delayMs));
      	// Opcionálisan: ellenőrizd, hogy közben nem szakadt-e a kapcsolat
      	if (!connectedDevice) {
        	logDebug('WRITE aborted: device disconnected');
        	return;
      	}
    	} else {
      	logDebug(`WRITE failed after ${maxRetries} attempts: ${commandName}`);
    	}
  	}
	}
  };

  // FE-C Basic Resistance (Page 48 / 0x30)
  const setTacxResistance = (level: number) => {
	const payload = Buffer.alloc(8);
	payload.writeUInt8(0x30, 0);    	// Page 48 (Basic Resistance)
	payload.writeUInt8(0xFF, 1);    	// Reserved
	const finalLevel = Math.max(0, Math.min(200, level));
	payload.writeUInt8(finalLevel, 2);  // 0..200
	for (let i = 3; i < 8; i++) payload.writeUInt8(0xFF, i);

	setResistance(finalLevel); // UI update
	sendTacxCommand(payload, `Resistance ${finalLevel}`);
  };

  // FE-C Target Power (Page 49 / 0x31) – 0.25 W egységek
  const setTacxTargetPower = (watts: number) => {
	const payload = Buffer.alloc(8);
	payload.writeUInt8(0x31, 0);    	// Page 49
	for (let i = 1; i < 6; i++) payload.writeUInt8(0xFF, i);
	const powerValue = Math.max(0, Math.round(watts * 4)); // 0.25 W
	payload.writeUInt16LE(powerValue, 6); // bytes 6–7
	sendTacxCommand(payload, `Target Power ${watts}W`);
  };

  // FE-C Grade/Slope (Page 51 / 0x33) – % * 100, signed Int16LE
  const setTacxSlope = (slopePercent: number) => {
	const payload = Buffer.alloc(8);
	payload.writeUInt8(0x33, 0);    	// Page 51
	for (let i = 1; i < 6; i++) payload.writeUInt8(0xFF, i);
	const slopeValue = Math.round(slopePercent * 100); // e.g. +5.00% => 500
	payload.writeInt16LE(slopeValue, 6); // bytes 6–7
	sendTacxCommand(payload, `Slope ${slopePercent}%`);
  };

  /** ------- Parsers ------- */
  const parseFTMSData = (buffer: Buffer) => {
	try {
  	const flags = buffer.readUInt16LE(0);
  	let offset = 2;
  	let speedKMH = 0;
  	let cadenceRPM = 0;
  	if (flags & 0x02) { const rawSpeed = buffer.readUInt16LE(offset); offset += 2; speedKMH = (rawSpeed / 100) * 3.6; }
  	if (flags & 0x08) { const rawCadence = buffer.readUInt16LE(offset); offset += 2; cadenceRPM = rawCadence / 2; setCadence(cadenceRPM); }
  	if (flags & 0x20) { const rawDistance = buffer.readUIntLE(offset, 3); offset += 3; setDistance(rawDistance / 1000); }
  	if (flags & 0x40) { const rawResistance = buffer.readInt16LE(offset); offset += 2; setResistance(rawResistance); }
  	if (cadenceRPM > 0 && speedKMH === 0) {
    	const circumference = Math.PI * wheelDiameter;
    	speedKMH = ((cadenceRPM * circumference) * 60) / 1000;
  	}
  	setSpeed(speedKMH);
	} catch (e: any) {
  	logDebug(`FTMS parse error: ${e?.message ?? e}`);
	}
  };

  const parseCSCMeasurement = (buffer: Buffer) => {
	try {
  	const flags = buffer.readUInt8(0);
  	let offset = 1;
  	const circumference = Math.PI * wheelDiameter;
  	if (flags & 0x01) {
    	const wheelRev = buffer.readUInt32LE(offset); offset += 4;
    	const wheelTime = buffer.readUInt16LE(offset); offset += 2;
    	if (lastCSC.current.wheelRev !== undefined && lastCSC.current.wheelTime !== undefined) {
      	const revDelta = deltaModulo(wheelRev, lastCSC.current.wheelRev, 0x100000000);
      	const timeDelta = deltaModulo(wheelTime, lastCSC.current.wheelTime, 0x10000) / 1024;
      	if (timeDelta > 0) setSpeed((revDelta * circumference / timeDelta) * 3.6);
    	}
    	lastCSC.current.wheelRev = wheelRev; lastCSC.current.wheelTime = wheelTime;
  	}
  	if (flags & 0x02) {
    	const crankRev = buffer.readUInt16LE(offset); offset += 2;
    	const crankTime = buffer.readUInt16LE(offset); offset += 2;
    	if (lastCSC.current.crankRev !== undefined && lastCSC.current.crankTime !== undefined) {
      	const revDelta = deltaModulo(crankRev, lastCSC.current.crankRev, 0x10000);
      	const timeDelta = deltaModulo(crankTime, lastCSC.current.crankTime, 0x10000) / 1024 / 60;
      	if (timeDelta > 0) setCadence(revDelta / timeDelta);
    	}
    	lastCSC.current.crankRev = crankRev; lastCSC.current.crankTime = crankTime;
  	}
	} catch (e: any) {
  	logDebug(`CSCS parse error: ${e?.message ?? e}`);
	}
  };

  const parseCPSMeasurement = (buffer: Buffer) => {
	try {
  	const instantaneousPower = buffer.readInt16LE(2);
  	setPower(instantaneousPower);
	} catch (e: any) {
  	logDebug(`CPS parse error: ${e?.message ?? e}`);
	}
  };

  const parseTacxData = (buffer: Buffer) => {
	try {
  	const page = buffer.readUInt8(0);
  	if (page === 0x10) {
    	const speedRaw = buffer.readUInt16LE(2); // 1/100 m/s
    	const cadenceRaw = buffer.readUInt8(4);
    	const powerRaw = buffer.readUInt16LE(5);
    	setSpeed((speedRaw / 100) * 3.6);
    	setCadence(cadenceRaw);
    	setPower(powerRaw);
  	}
	} catch (e: any) {
  	logDebug(`Tacx parse error: ${e?.message ?? e}`);
	}
  };

  const deltaModulo = (current: number, previous: number, modulo: number) => {
	const raw = current - previous;
	return raw >= 0 ? raw : raw + modulo;
  };

  /** ------- UI ------- */
  return (
	<FlatList
  	data={devices}
  	keyExtractor={(item) => item.id}
  	ListHeaderComponent={
    	<View style={{ padding: 10 }}>
      	<Text style={styles.title}>🚴 BLE Cycling App (Debug & Fix)</Text>

      	<View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 }}>
        	<Button
          	title={isScanning ? 'Scanning...' : 'Start Scan'}
          	onPress={scanDevices}
          	disabled={isScanning || isConnecting}
        	/>
        	<Button
          	title="Disconnect"
          	onPress={disconnectDevice}
          	disabled={!connectedDevice}
          	color="#ff3333"
        	/>
      	</View>

      	{isConnecting && <ActivityIndicator size="large" color="#0000ff" />}
      	{errorMsg && <Text style={{ color: 'red', fontWeight: 'bold' }}>Hiba: {errorMsg}</Text>}

      	{connectedDevice && (
        	<View style={styles.connectedInfo}>
          	<Text style={{ fontWeight: 'bold' }}>Connected: {connectedDevice.name}</Text>
          	<Text>
            	FTMS: {hasFTMS ? '✅' : '❌'}{'  '}
            	CSCS: {hasCSCS ? '✅' : '❌'}{'  '}
            	CPS:  {hasCPS  ? '✅' : '❌'}{'  '}
            	Tacx SVC: {hasTacx ? '✅' : '❌'}{'  '}
            	Tacx READY: {tacxReady ? '✅' : '❌'}
          	</Text>
        	</View>
      	)}

      	<View style={styles.metricContainer}>
        	<Text style={styles.metricText}>Speed: {speed.toFixed(1)} km/h</Text>
        	<Text style={styles.metricText}>Cadence: {cadence.toFixed(0)} RPM</Text>
        	<Text style={styles.metricText}>Power: {power.toFixed(0)} W</Text>
        	<Text style={styles.metricText}>Distance (FTMS): {distance.toFixed(2)} km</Text>
        	<Text style={styles.metricText}>Resistance (FTMS): {resistance}</Text>
      	</View>

      	<Text style={styles.subtitle}>Kerékméret (CSC/FTMS sebességhez):</Text>
      	<Picker selectedValue={wheelDiameter} onValueChange={(value) => setWheelDiameter(value)}>
        	{wheelSizes.map(size => (
          	<Picker.Item key={size.label} label={size.label} value={size.diameter} />
        	))}
      	</Picker>

      	{/* Manual subscriptions */}
      	<Text style={styles.subtitle}>Adatfolyam Feliratkozások:</Text>
      	<View style={styles.buttonGroup}>
        	<Button title="Subscribe FTMS Indoor Bike Data" onPress={subscribeFTMS_IBD} disabled={!hasFTMS || !connectedDevice} />
        	<Button title="Subscribe CSCS Measurement"  onPress={subscribeCSCS}	disabled={!hasCSCS || !connectedDevice} />
        	<Button title="Subscribe CPS Measurement"   onPress={subscribeCPS} 	disabled={!hasCPS  || !connectedDevice} />
        	<Button title="Subscribe Tacx FE-C Notify" onPress={subscribeTacxNotify} disabled={!tacxReady || !connectedDevice} />
      	</View>

      	{/* ÚJ: Tacx Control – gombok elrejtése, ha nem ready */}
      	{tacxReady && (
        	<View style={{ marginVertical: 10, borderWidth: 1, borderColor: '#0000ff', padding: 10, borderRadius: 5 }}>
          	<Text style={{ fontWeight: 'bold', fontSize: 18 }}>Tacx Control (FE-C)</Text>
          	<View style={styles.tacxButtonGroup}>
            	<Button title="Resistance +5" onPress={() => setTacxResistance(resistance + 5)} />
            	<Button title="Resistance -5" onPress={() => setTacxResistance(resistance - 5)} />
          	</View>
          	<TextInput style={styles.input} placeholder="Target Power (W)" keyboardType="numeric" value={targetPower} onChangeText={setTargetPower} />
          	<Button title={`Set Target Power (${targetPower}W)`} onPress={() => setTacxTargetPower(Number(targetPower) || 0)} />
          	<TextInput style={styles.input} placeholder="Slope (%)" keyboardType="numeric" value={slope} onChangeText={setSlope} />
          	<Button title={`Set Slope (${slope}%)`} onPress={() => {
            	const numericSlope = Number(slope);
            	const finalSlope = isNaN(numericSlope) ? 0 : numericSlope;
            	setTacxSlope(finalSlope);
          	}} />
        	</View>
      	)}

      	<Text style={styles.subtitle}>Elérhető Eszközök (Kattints a csatlakozáshoz):</Text>
    	</View>
  	}
  	renderItem={({ item }) => (
    	<TouchableOpacity
      	style={styles.deviceItem}
      	onPress={() => connectToDevice(item)}
      	disabled={isConnecting}
    	>
      	<Text style={{fontWeight: 'bold'}}>{item.name ?? 'Ismeretlen Eszköz'}</Text>
      	<Text style={{fontSize: 12, color: '#666'}}>{item.id}</Text>
    	</TouchableOpacity>
  	)}
  	ListFooterComponent={
    	<View style={{ padding: 10 }}>
      	<Text style={styles.subtitle}>GATT Services & Characteristics (Felfedezett):</Text>
      	{gattInfo.map((service, idx) => (
        	<View key={idx} style={styles.gattItem}>
          	<Text style={{ fontWeight: 'bold' }}>Service: {service.service}</Text>
          	{service.characteristics.length === 0 && <Text style={{ color: '#999' }}>(nincs karakterisztika)</Text>}
          	{service.characteristics.map((char, i) => (
            	<Text key={i} style={{fontSize: 12}}>Characteristic: {char}</Text>
          	))}
        	</View>
      	))}
      	<Text style={styles.subtitle}>Debug Logs (Max 50):</Text>
      	<View style={styles.logContainer}>
        	{debugLogs.map((log, i) => <Text key={i} style={{ fontSize: 10, color: '#00ff00' }}>{log}</Text>)}
      	</View>
    	</View>
  	}
	/>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 16, marginTop: 10, fontWeight: '600' },
  deviceItem: { padding: 10, borderBottomWidth: 1, borderColor: '#eee', backgroundColor: '#fff', marginHorizontal: 5, marginVertical: 2, borderRadius: 3 },
  gattItem: { marginVertical: 5, padding: 5, backgroundColor: '#eef', borderRadius: 5, borderWidth: 1, borderColor: '#ddd' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 8, marginVertical: 5, borderRadius: 5, backgroundColor: 'white' },
  connectedInfo: { padding: 10, backgroundColor: '#d4edda', borderColor: '#c3e6cb', borderWidth: 1, borderRadius: 5, marginVertical: 10 },
  metricContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginVertical: 10, padding: 5, borderWidth: 1, borderColor: '#ddd', borderRadius: 5 },
  metricText: { fontSize: 14, fontWeight: 'bold', width: '50%', paddingVertical: 2 },
  buttonGroup: { marginVertical: 5, gap: 5 },
  tacxButtonGroup: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 10, gap: 10 },
  logContainer: { backgroundColor: '#333', maxHeight: 150, padding: 5, borderRadius: 5, overflow: 'hidden' }

})
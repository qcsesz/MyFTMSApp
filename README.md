# MyFTMSApp - a basic project to get familiar with BLE FTMS and FE-C communication

(ai generated readme)
This is a mobile application developed with **React Native** for managing and interacting with devices via **Bluetooth Low Energy (BLE)**.

---

## Overview

The My FTMS App is designed to provide a seamless interface for users to connect to and monitor specific external hardware. 
The core functionality revolves around **data exchange** and **real-time device status monitoring**.

### Key Features:

* **BLE Connectivity:** Seamlessly connect to nearby compatible hardware using Bluetooth Low Energy.
* **Data Monitoring:** Display real-time data received from the connected device.
* **Custom Communication:** Implements specific communication protocols for unique device characteristics (like CE-F for firmware settings).
* **User Interface:** A native-like experience powered by React Native.

---

## Technology Stack

* **Framework:** React Native
* **Mobile Platform:** Android
* **Bluetooth:** Custom integration using a BLE library (e.g., `react-native-ble-plx`)
* **Asynchronous Operations:** Leverages RxJava/RxKotlin for robust asynchronous and concurrent data handling.

---

## Known Issues & Troubleshooting

The application sometimes experiences issues related to the Android runtime environment and BLE communication stability, 
which developers are actively addressing.

### Common Errors:

* **SoftException on Window Focus:** An intermittent timing issue where the React Native context is accessed before it is fully ready upon window focus changes. This is generally a non-critical error but indicates a timing sensitivity within the UI lifecycle.
* **Fatal BLE Errors:** Occasional application crashes occur when attempting to monitor or write to Bluetooth characteristics. These typically involve:
    * Failure to monitor specific device characteristics (`CannotMonitorCharacteristicException`).
    * Internal runtime errors (`NullPointerException`) during error handling of failed BLE operations, often pointing to an issue in the underlying library when rejecting promises.

---

## Setup and Installation

Instructions for setting up and running the project locally.

1. **Clone the Repository:**
    ```bash
    git clone [Your Repository URL]
    ```
2. **Install Dependencies:**
    ```bash
    npm install # or yarn install
    ```
3. **Run on Android:**
    ```bash
    npx react-native run-android
    ```
    *Note: Ensure all required Bluetooth and Location permissions are granted on the target Android device.*

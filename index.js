/**
 * @format
 */

import { AppRegistry } from 'react-native';
//import App from './App';
import { name as appName } from './app.json';

import RNTesterPlayground from './RNTesterPlayground';
export default RNTesterPlayground;


//AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerComponent(appName, () => RNTesterPlayground);

import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import HomeScreen    from './screens/HomeScreen';
import OrderScreen   from './screens/OrderScreen';
import CameraScreen  from './screens/CameraScreen';
import MessageScreen from './screens/MessageScreen';
import { C } from './lib/supabase';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="light" backgroundColor={C.darkNav} />
        <Stack.Navigator
          screenOptions={{
            headerStyle:      { backgroundColor: C.darkNav },
            headerTintColor:  '#ffffff',
            headerTitleStyle: { fontWeight: '600', fontSize: 16 },
            headerBackTitleVisible: false,
            contentStyle:     { backgroundColor: C.bg },
          }}
        >
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: '주문관리', headerLargeTitle: false }}
          />
          <Stack.Screen
            name="Order"
            component={OrderScreen}
            options={({ route }) => ({ title: route.params?.customer?.name || '주문 확인' })}
          />
          <Stack.Screen
            name="Camera"
            component={CameraScreen}
            options={{ title: '송장 촬영', headerStyle: { backgroundColor: '#000' }, headerTintColor: '#fff' }}
          />
          <Stack.Screen
            name="Message"
            component={MessageScreen}
            options={{ title: '발송 메시지' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

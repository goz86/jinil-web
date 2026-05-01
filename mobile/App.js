import 'react-native-gesture-handler';
import React from 'react';
import { View, ActivityIndicator, TouchableOpacity, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import HomeScreen    from './screens/HomeScreen';
import OrderScreen   from './screens/OrderScreen';
import CameraScreen  from './screens/CameraScreen';
import MessageScreen from './screens/MessageScreen';
import { C } from './lib/supabase';
import { AuthProvider, useAuth } from './lib/auth';
import LoginScreen from './screens/LoginScreen';

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const { session, loading, signOut } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f7' }}>
        <ActivityIndicator size="large" color="#0066cc" />
      </View>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
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
        options={{
          title: '주문관리',
          headerLargeTitle: false,
          headerRight: () => (
            <TouchableOpacity onPress={signOut} style={{ marginRight: 8, padding: 6 }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', opacity: 0.8 }}>로그아웃</Text>
            </TouchableOpacity>
          ),
        }}
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
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="light" backgroundColor={C.darkNav} />
        <AuthProvider>
          <AppNavigator />
        </AuthProvider>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

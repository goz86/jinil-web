import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { C } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STEPS = [
  { label: '신규',     color: C.blue },
  { label: '출고대기', color: C.amber },
  { label: '출고완료', color: C.green },
  { label: '미결제',   color: C.red },
  { label: '결제완료', color: '#7c3aed' }, // Purple
];

export default function OrderStepper({ status, isPaid }) {
  // Mapping logic: 0 to 4
  let currentStep = 0;
  if (status === 'shipped') {
    currentStep = isPaid ? 4 : 3;
  } else if (status === 'pending' || status === 'partial') {
    currentStep = 1;
  } else {
    currentStep = 0;
  }

  // Animation values
  const lineWidth = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Line animation
    Animated.timing(lineWidth, {
      toValue: currentStep / (STEPS.length - 1),
      duration: 800,
      useNativeDriver: false, // Width/Flex can't use native driver
    }).start();

    // Pulse animation for current step
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseScale, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [currentStep]);

  return (
    <View style={styles.container}>
      {/* Background Line */}
      <View style={styles.lineBg} />
      
      {/* Active Line (Animated) */}
      <Animated.View 
        style={[
          styles.lineActive, 
          { 
            width: lineWidth.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%']
            }),
            backgroundColor: STEPS[currentStep].color 
          }
        ]} 
      />

      <View style={styles.stepsRow}>
        {STEPS.map((step, idx) => {
          const isCompleted = idx < currentStep;
          const isActive = idx === currentStep;
          const color = (isCompleted || isActive) ? step.color : C.inkLight;

          return (
            <View key={idx} style={styles.stepItem}>
              {/* Pulse effect for active step */}
              {isActive && (
                <Animated.View 
                  style={[
                    styles.pulse, 
                    { transform: [{ scale: pulseScale }], backgroundColor: color + '30' }
                  ]} 
                />
              )}
              
              <View style={[
                styles.dot, 
                { backgroundColor: (isCompleted || isActive) ? color : '#fff', borderColor: color }
              ]}>
                {isCompleted && <Text style={styles.check}>✓</Text>}
              </View>
              
              <Text style={[
                styles.label, 
                { color: isActive ? color : C.inkMuted, fontWeight: isActive ? '700' : '500' }
              ]}>
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    marginVertical: 10,
    marginHorizontal: 14,
    // iOS shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    // Android shadow
    elevation: 2,
  },
  lineBg: {
    position: 'absolute',
    top: 36, // Center of dots
    left: 45,
    right: 45,
    height: 2,
    backgroundColor: '#f1f3f5',
  },
  lineActive: {
    position: 'absolute',
    top: 36,
    left: 45,
    // width is animated
    maxWidth: SCREEN_WIDTH - 120, // Adjust based on padding
    height: 2,
  },
  stepsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepItem: {
    alignItems: 'center',
    width: 60,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  pulse: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    top: -8,
  },
  check: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
  },
  label: {
    fontSize: 10,
    marginTop: 8,
    textAlign: 'center',
  },
});

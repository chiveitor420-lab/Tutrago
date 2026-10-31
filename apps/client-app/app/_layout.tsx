import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useWalletStore } from '../src/store/walletStore';

export default function RootLayout() {
  const hydrateFromStorage = useWalletStore((s) => s.hydrateFromStorage);

  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#09090B',
          },
          headerTintColor: '#FAFAFA',
          headerTitleStyle: {
            fontWeight: '900',
          },
          contentStyle: {
            backgroundColor: '#09090B',
          },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="v/[tenantId]"
          options={{
            title: 'Acceso Rápido QR',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="(club)/[tenantId]/index"
          options={{
            title: 'Carta de Tragos',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="wallet/index"
          options={{
            title: 'Mis Vales',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="ticket/[ticketId]"
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
          }}
        />
      </Stack>
    </>
  );
}

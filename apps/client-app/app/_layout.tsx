import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
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
        <Stack.Screen name="(club)/[tenantId]/index" options={{ title: 'Carta de Tragos' }} />
        <Stack.Screen name="wallet/index" options={{ title: 'Mis Tragos en Espera' }} />
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

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import {
  WsBarTicketPrintEvent,
  WsTicketStatusChangeEvent,
  WsStockToggleEvent,
  WsOrderPaymentEvent,
} from '@tutrago/shared-types';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`[Socket.io] Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[Socket.io] Cliente desconectado: ${client.id}`);
  }

  // Unión de la PC/Tablet de la barra a su sala dedicada
  @SubscribeMessage('join:bar')
  handleJoinBar(@ConnectedSocket() client: Socket, @MessageBody() data: { barId: string }) {
    const room = `bar:${data.barId}`;
    client.join(room);
    console.log(`[Socket.io] Socket ${client.id} se unió a la sala ${room}`);
    return { status: 'JOINED', room };
  }

  // Unión del panel de administración del boliche
  @SubscribeMessage('join:tenant')
  handleJoinTenant(@ConnectedSocket() client: Socket, @MessageBody() data: { tenantId: string }) {
    const room = `tenant:${data.tenantId}`;
    client.join(room);
    console.log(`[Socket.io] Socket ${client.id} se unió al panel admin ${room}`);
    return { status: 'JOINED', room };
  }

  // Unión del teléfono del cliente a la sala de su ticket
  @SubscribeMessage('join:ticket')
  handleJoinTicket(@ConnectedSocket() client: Socket, @MessageBody() data: { ticketId: string }) {
    const room = `ticket:${data.ticketId}`;
    client.join(room);
    console.log(`[Socket.io] Socket ${client.id} se unió al ticket ${room}`);
    return { status: 'JOINED', room };
  }

  // Unión del teléfono del cliente a la sala de su orden financiera (checkout en vivo)
  @SubscribeMessage('join:order')
  handleJoinOrder(@ConnectedSocket() client: Socket, @MessageBody() data: { orderId: string }) {
    const room = `order:${data.orderId}`;
    client.join(room);
    console.log(`[Socket.io] Socket ${client.id} se unió a la orden ${room}`);
    return { status: 'JOINED', room };
  }

  /**
   * Notifica a la comandera de barra para disparar la impresión térmica ESC/POS
   */
  emitTicketPrint(barId: string, payload: WsBarTicketPrintEvent) {
    if (!this.server) return;
    this.server.to(`bar:${barId}`).emit('bar:ticket_print', payload);
    this.server.emit('metrics:updated', { barId, timestamp: new Date().toISOString() });
  }

  /**
   * Notifica al teléfono del cliente que su pedido está listo (vibración y pase visual)
   */
  emitTicketReady(ticketId: string, payload: WsTicketStatusChangeEvent) {
    if (!this.server) return;
    this.server.to(`ticket:${ticketId}`).emit('ticket:ready_vibrate', payload);
  }

  /**
   * Notifica cambio general de estado
   */
  emitTicketStatus(ticketId: string, barId: string, payload: WsTicketStatusChangeEvent) {
    if (!this.server) return;
    this.server.to(`ticket:${ticketId}`).emit('ticket:status_changed', payload);
    this.server.to(`bar:${barId}`).emit('bar:ticket_updated', payload);
    this.server.emit('metrics:updated', { barId, ticketId, status: payload.status });
  }

  /**
   * Difunde actualización instantánea de stock a todas las pantallas
   */
  emitStockToggle(payload: WsStockToggleEvent) {
    if (!this.server) return;
    this.server.emit('stock:toggled', payload);
  }

  /**
   * Difunde actualización del catálogo o barras (ABM desde /admin)
   */
  emitCatalogUpdate(tenantId: string, payload: any) {
    if (!this.server) return;
    this.server.emit('catalog:updated', { tenantId, ...payload });
  }

  /**
   * Notifica acreditación instantánea de vales (PAID_ON_HOLD) o reembolso al celular del usuario
   */
  emitOrderPaymentUpdate(orderId: string, payload: WsOrderPaymentEvent) {
    if (!this.server) return;
    this.server.to(`order:${orderId}`).emit('order:payment_updated', payload);
    this.server.emit(`user:${payload.userId}:wallet_updated`, payload);
  }
}

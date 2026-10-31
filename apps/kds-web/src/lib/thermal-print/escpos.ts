/**
 * Conductor de Impresión Térmica ESC/POS (80mm) para Barras de Boliche.
 * Implementa salida directa por WebUSB API, WebSerial API y fallback a @media print de 80mm.
 */

export interface ThermalPrintTicketData {
  barName: string;
  shortCode: string;
  securityColor: string;
  activatedAt: string | Date;
  items: Array<{
    name: string;
    quantity: number;
  }>;
}

export class EscPosThermalPrinter {
  // Comandos ESC/POS binarios
  private static readonly ESC = 0x1b;
  private static readonly GS = 0x1d;

  /**
   * Genera el buffer binario con la comanda ESC/POS para papel de 80mm
   */
  public static buildEscPosBuffer(data: ThermalPrintTicketData): Uint8Array {
    const bytes: number[] = [];

    const append = (...vals: number[]) => bytes.push(...vals);
    const appendText = (text: string) => {
      const encoder = new TextEncoder();
      const encoded = encoder.encode(text);
      for (let i = 0; i < encoded.length; i++) {
        bytes.push(encoded[i]);
      }
    };

    // 1. Inicializar impresora: ESC @
    append(this.ESC, 0x40);

    // 2. Centrar texto: ESC a 1
    append(this.ESC, 0x61, 0x01);

    // Encabezado
    appendText('================================\n');
    appendText(`*** ${data.barName.toUpperCase()} ***\n`);
    appendText('================================\n\n');

    // 3. Short Code en tamaño Cuádruple: GS ! 0x33 (Doble alto + Doble ancho)
    appendText('TURNO DE RETIRO:\n');
    append(this.GS, 0x21, 0x33);
    appendText(` #${data.shortCode} \n`);

    // Resetear a tamaño normal: GS ! 0x00
    append(this.GS, 0x21, 0x00);
    appendText(`Color de Control: [${data.securityColor}]\n\n`);

    // 4. Alinear a la izquierda para el detalle de bebidas: ESC a 0
    append(this.ESC, 0x61, 0x00);
    appendText('--------------------------------\n');
    appendText('CANT  BEBIDA / DETALLE\n');
    appendText('--------------------------------\n');

    for (const item of data.items) {
      const line = ` [ ${item.quantity}x ]  ${item.name}\n`;
      appendText(line);
    }

    appendText('--------------------------------\n\n');

    // 5. Pie de ticket y hora
    append(this.ESC, 0x61, 0x01); // Centrar
    const timeStr = new Date(data.activatedAt).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    appendText(`Hora de Comanda: ${timeStr}\n`);
    appendText('TUTRAGO INCUBATIO - FAST PICKUP\n\n\n\n');

    // 6. Corte parcial de papel: GS V 66 0
    append(this.GS, 0x56, 66, 0);

    return new Uint8Array(bytes);
  }

  /**
   * Intenta imprimir directamente vía WebUSB API (impresoras térmicas USB Epson/POS-80)
   */
  public static async printViaWebUsb(data: ThermalPrintTicketData): Promise<boolean> {
    if (typeof window === 'undefined' || !('usb' in navigator)) {
      return false;
    }

    try {
      const usbNav = (navigator as any).usb;
      const devices = await usbNav.getDevices();
      const device = devices[0];
      if (!device) {
        return false;
      }
      await device.open();
      if (device.configuration === null) {
        await device.selectConfiguration(1);
      }
      await device.claimInterface(0);
      const buffer = this.buildEscPosBuffer(data);
      await device.transferOut(1, buffer);
      await device.close();
      console.log('[ThermalPrinter] Impresión física completada vía WebUSB.');
      return true;
    } catch (err) {
      console.warn('[ThermalPrinter] WebUSB no disponible:', err);
      return false;
    }
  }

  /**
   * Intenta imprimir a través de WebSerial API (puerto COM/USB de Windows)
   */
  public static async printViaWebSerial(data: ThermalPrintTicketData): Promise<boolean> {
    if (typeof window === 'undefined' || !('serial' in navigator)) {
      return false;
    }

    try {
      const serialNav = (navigator as any).serial;
      const ports = await serialNav.getPorts();
      const port = ports[0];
      if (!port) {
        return false;
      }
      await port.open({ baudRate: 9600 });
      const writer = port.writable.getWriter();
      const buffer = this.buildEscPosBuffer(data);
      await writer.write(buffer);
      writer.releaseLock();
      await port.close();
      console.log('[ThermalPrinter] Impresión física completada vía WebSerial.');
      return true;
    } catch (err) {
      console.warn('[ThermalPrinter] WebSerial no disponible:', err);
      return false;
    }
  }

  /**
   * Despacha comanda intentando WebUSB -> WebSerial -> Fallback Impresión Navegador 80mm
   */
  public static async dispatchThermalPrint(
    data: ThermalPrintTicketData,
    triggerBrowserDialog = false
  ): Promise<{ method: 'WEB_USB' | 'WEB_SERIAL' | 'BROWSER_80MM'; byteSize: number }> {
    const buffer = this.buildEscPosBuffer(data);

    const printedUsb = await this.printViaWebUsb(data);
    if (printedUsb) {
      return { method: 'WEB_USB', byteSize: buffer.byteLength };
    }

    const printedSerial = await this.printViaWebSerial(data);
    if (printedSerial) {
      return { method: 'WEB_SERIAL', byteSize: buffer.byteLength };
    }

    this.printViaHtmlFallback(data, triggerBrowserDialog);
    return { method: 'BROWSER_80MM', byteSize: buffer.byteLength };
  }

  /**
   * Renderiza la comanda en formato térmico de 80mm (@media print)
   */
  public static printViaHtmlFallback(data: ThermalPrintTicketData, openDialog = false) {
    if (typeof window === 'undefined') return;

    const existing = document.getElementById('tutrago-thermal-print-frame');
    if (existing) existing.remove();

    const printFrame = document.createElement('iframe');
    printFrame.id = 'tutrago-thermal-print-frame';
    printFrame.style.position = 'absolute';
    printFrame.style.top = '-9999px';
    printFrame.style.left = '-9999px';
    document.body.appendChild(printFrame);

    const timeStr = new Date(data.activatedAt).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const itemsHtml = data.items
      .map(
        (i) => `
        <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: bold; margin: 6px 0;">
          <span>[ ${i.quantity}x ]</span>
          <span style="flex: 1; text-align: right;">${i.name}</span>
        </div>`
      )
      .join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: monospace; font-size: 14px; width: 72mm; color: #000; text-align: center; }
            .header { border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
            .short-code { font-size: 42px; font-weight: 900; margin: 10px 0; border: 3px solid #000; padding: 4px; }
            .items { text-align: left; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 8px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2 style="margin: 0;">${data.barName.toUpperCase()}</h2>
            <small>TUTRAGO - COMANDA EN BARRA (80MM)</small>
          </div>
          <div class="short-code">#${data.shortCode}</div>
          <p>Color Control: <b>${data.securityColor}</b></p>
          <div class="items">
            ${itemsHtml}
          </div>
          <p style="margin-top: 10px; font-size: 12px;">Hora: ${timeStr}</p>
        </body>
      </html>
    `;

    printFrame.contentDocument?.open();
    printFrame.contentDocument?.write(htmlContent);
    printFrame.contentDocument?.close();

    if (openDialog) {
      setTimeout(() => {
        try {
          printFrame.contentWindow?.focus();
          printFrame.contentWindow?.print();
        } catch {
          // ignore
        }
      }, 300);
    }
  }
}

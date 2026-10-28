import { PrismaClient, OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Iniciando Seed de Base de Datos Tutrago ---');

  // 1. Limpieza de datos previos (desarrollo)
  await prisma.pickupTicketItem.deleteMany();
  await prisma.pickupTicket.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productUpsell.deleteMany();
  await prisma.product.deleteMany();
  await prisma.bar.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.user.deleteMany();

  // 2. Crear Boliche Principal (Tenant)
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Club Nocturno Tutrago Central',
      slug: 'club-tutrago',
      commissionPct: 10.0,
      isActive: true,
      mpAccessToken: 'TEST-ACCESS-TOKEN-TUTRAGO-BOLICHE',
    },
  });
  console.log(`[Seed] Boliche creado: ${tenant.name} (${tenant.id})`);

  // 3. Crear 3 Barras Internas con límites de Throttling
  const barPista = await prisma.bar.create({
    data: {
      tenantId: tenant.id,
      name: 'Barra Pista Central',
      maxConcurrentPrep: 15,
      printerType: 'WEB_SERIAL_80MM',
    },
  });

  const barVip = await prisma.bar.create({
    data: {
      tenantId: tenant.id,
      name: 'Barra Terraza VIP',
      maxConcurrentPrep: 10,
      printerType: 'WEB_USB_80MM',
    },
  });

  const barPatio = await prisma.bar.create({
    data: {
      tenantId: tenant.id,
      name: 'Barra Patio Electrónica',
      maxConcurrentPrep: 12,
      printerType: 'WEB_SERIAL_80MM',
    },
  });
  console.log(`[Seed] Barras creadas: Pista Central, Terraza VIP, Patio Electrónica`);

  // 4. Crear 15 Productos con Opciones de Upselling
  const productsData = [
    {
      name: 'Fernet Branca con Coca-Cola',
      description: 'El clásico argentino preparado con Fernet Branca de 750ml y hielo roca.',
      price: 9500,
      category: 'Tragos Clásicos',
      imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500',
      isAvailable: true,
      sortOrder: 1,
      upsells: [
        { title: 'Medida Doble de Fernet', additionalPrice: 4000, description: 'Agrega un 50% extra de Fernet Branca' },
        { title: 'Vaso Coleccionable XL', additionalPrice: 2500, description: 'Vaso térmico exclusivo de la noche' },
      ],
    },
    {
      name: 'Gin Tonic Nacional',
      description: 'Gin artesanal nacional perfumado con bayas de enebro y tónica Schweppes.',
      price: 8500,
      category: 'Gin & Cocktails',
      imageUrl: 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?w=500',
      isAvailable: true,
      sortOrder: 2,
      upsells: [
        { title: 'Upgrade a Gin Bombay Sapphire', additionalPrice: 4500, description: 'Cambia el gin nacional por Bombay Sapphire' },
        { title: 'Upgrade a Gin Hendrick’s', additionalPrice: 7000, description: 'Servido con rodajas de pepino y pimienta rosa' },
      ],
    },
    {
      name: 'Vodka Smirnoff con Red Bull',
      description: 'Vodka triple destilación servido con lata fría de energizante.',
      price: 11000,
      category: 'Tragos con Energizante',
      imageUrl: 'https://images.unsplash.com/photo-1560512823-829485b8bf24?w=500',
      isAvailable: true,
      sortOrder: 3,
      upsells: [
        { title: 'Upgrade a Vodka Absolut', additionalPrice: 4000, description: 'Sabor más puro y sedoso' },
        { title: 'Upgrade a Grey Goose Premium', additionalPrice: 9000, description: 'Vodka premium francés de máxima pureza' },
      ],
    },
    {
      name: 'Campari Orange',
      description: 'Campari italiano con jugo de naranja exprimido y rodaja fresca.',
      price: 8000,
      category: 'Tragos Clásicos',
      imageUrl: 'https://images.unsplash.com/photo-1536935338788-846bb9981813?w=500',
      isAvailable: true,
      sortOrder: 4,
      upsells: [
        { title: 'Jugo de Naranja 100% Orgánico', additionalPrice: 1500, description: 'Naranjas recién exprimidas en frío' },
      ],
    },
    {
      name: 'Mojito Clásico Cubano',
      description: 'Ron blanco, hojas de menta fresca machacada, lima, azúcar y soda.',
      price: 9000,
      category: 'Cocktails',
      imageUrl: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500',
      isAvailable: true,
      sortOrder: 5,
      upsells: [
        { title: 'Upgrade a Ron Havana 7 Años', additionalPrice: 3500, description: 'Añejamiento natural en barricas de roble' },
      ],
    },
    {
      name: 'Cerveza Corona 330ml',
      description: 'Porrón frío servido con gajo de lima.',
      price: 5500,
      category: 'Cervezas',
      imageUrl: 'https://images.unsplash.com/photo-1608270199042-4f911cf4e58b?w=500',
      isAvailable: true,
      sortOrder: 6,
      upsells: [
        { title: 'Balde de 5 Coronas', additionalPrice: 20000, description: 'Ahorro de $7.500 en balde de hielo' },
      ],
    },
    {
      name: 'Cerveza Patagonia Bohemian Pilsener 730ml',
      description: 'Botella de cerveza artesanal rubia con maltas checas.',
      price: 8500,
      category: 'Cervezas',
      imageUrl: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=500',
      isAvailable: true,
      sortOrder: 7,
      upsells: [],
    },
    {
      name: 'Whisky Johnnie Walker Red con Hielo',
      description: 'Whisky escocés blend clásico servido en vaso bajo con hielo tallado.',
      price: 10500,
      category: 'Whiskies',
      imageUrl: 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=500',
      isAvailable: true,
      sortOrder: 8,
      upsells: [
        { title: 'Upgrade a Johnnie Walker Black Label (12 años)', additionalPrice: 6000, description: 'Perfil ahumado y notas a frutas oscuras' },
      ],
    },
    {
      name: 'Aperol Spritz',
      description: 'Aperol, vino espumante Prosecco, golpe de soda y rodaja de naranja.',
      price: 9000,
      category: 'Cocktails',
      imageUrl: 'https://images.unsplash.com/photo-1560512823-829485b8bf24?w=500',
      isAvailable: true,
      sortOrder: 9,
      upsells: [
        { title: 'Espumante Chandon Extra Brut', additionalPrice: 3000, description: 'Base premium Chandon' },
      ],
    },
    {
      name: 'Combo VIP: Botella Chandon + 4 Speed',
      description: 'Botella de 750ml en frapera con hielo y 4 latas de Speed Unlimited.',
      price: 36000,
      category: 'Combos VIP',
      imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500',
      isAvailable: true,
      sortOrder: 10,
      upsells: [
        { title: 'Upgrade a Chandon Délice', additionalPrice: 5000, description: 'Servido con hielo, albahaca y pomelo' },
        { title: 'Upgrade a Moët & Chandon Imperial', additionalPrice: 55000, description: 'Champagne francés de lujo' },
      ],
    },
    {
      name: 'Combo VIP: Botella Jagermeister + 4 Red Bull',
      description: 'Botella de 700ml con 4 latas energizantes y 4 chupitos fríos.',
      price: 48000,
      category: 'Combos VIP',
      imageUrl: 'https://images.unsplash.com/photo-1549740425-8e95a9e6302f?w=500',
      isAvailable: true,
      sortOrder: 11,
      upsells: [],
    },
    {
      name: 'Red Bull Energy Drink 250ml',
      description: 'Lata de bebida energizante fría.',
      price: 4500,
      category: 'Sin Alcohol',
      imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500',
      isAvailable: true,
      sortOrder: 12,
      upsells: [],
    },
    {
      name: 'Agua Mineral Eco de los Andes 500ml',
      description: 'Agua pura de manantial sin gas bien fría.',
      price: 3000,
      category: 'Sin Alcohol',
      imageUrl: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=500',
      isAvailable: true,
      sortOrder: 13,
      upsells: [],
    },
    {
      name: 'Gaseosa Coca-Cola Original 354ml',
      description: 'Lata helada de Coca-Cola sabor original.',
      price: 3500,
      category: 'Sin Alcohol',
      imageUrl: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500',
      isAvailable: true,
      sortOrder: 14,
      upsells: [],
    },
    {
      name: 'Shot Tequila José Cuervo Especial',
      description: 'Chupito de tequila dorado servido con sal marina y rodaja de lima.',
      price: 5000,
      category: 'Shots',
      imageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500',
      isAvailable: true,
      sortOrder: 15,
      upsells: [
        { title: 'Upgrade a Tequila Patrón Silver', additionalPrice: 4000, description: '100% agave azul ultra-premium' },
      ],
    },
  ];

  for (const item of productsData) {
    const { upsells, ...productFields } = item;
    const product = await prisma.product.create({
      data: {
        ...productFields,
        tenantId: tenant.id,
        upsells: {
          create: upsells,
        },
      },
    });
    console.log(`[Seed] Producto creado: ${product.name} con ${upsells.length} upsells`);
  }

  // 5. Crear Usuario de prueba con una orden en "PAID_ON_HOLD"
  const user = await prisma.user.create({
    data: {
      email: 'juan.perez@tutrago.com',
      fullName: 'Juan Pérez',
      phone: '+5491134567890',
    },
  });

  const fernetProduct = await prisma.product.findFirst({
    where: { name: { contains: 'Fernet' } },
  });

  const ginProduct = await prisma.product.findFirst({
    where: { name: { contains: 'Gin' } },
  });

  if (fernetProduct && ginProduct) {
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        totalAmount: 27500,
        platformFee: 2750,
        paymentStatus: OrderStatus.PAID_ON_HOLD,
        mpPaymentId: 'MP-TEST-99281742',
        items: {
          create: [
            {
              productId: fernetProduct.id,
              unitPrice: fernetProduct.price,
              quantityPurchased: 2,
              quantityRemaining: 2, // 2 Fernets listos para canjear en la Wallet
            },
            {
              productId: ginProduct.id,
              unitPrice: ginProduct.price,
              quantityPurchased: 1,
              quantityRemaining: 1, // 1 Gin listo para canjear
            },
          ],
        },
      },
    });
    console.log(`[Seed] Orden de prueba creada en PAID_ON_HOLD: ID ${order.id} con 3 tragos disponibles`);
  }

  console.log('--- Seed completado con éxito ---');
}

main()
  .catch((e) => {
    console.error('Error durante el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export const STORE = {
  name: 'Fluxo Outlet',

  location: {
    city: 'Uberaba',
    state: 'MG',
    hasPhysicalStore: true,
    localPickup: true,
  },

  delivery: {
    local: true,
    nationwide: true,
    localDays: '1 a 2 dias úteis',
    nationwideDays: '3 a 7 dias úteis',
    carriers: 'Correios e motoboy local',
  },

  hours: {
    weekdays: '9h às 18h',
    saturday: '9h às 13h',
    sunday: 'fechado',
    full: 'segunda a sexta das 9h às 18h, sábados das 9h às 13h',
  },

  payment: {
    methods: ['Pix', 'Cartão de crédito (até 6x)', 'Cartão de débito', 'Boleto bancário'],
    short: 'Pix, cartão em até 6x, débito e boleto',
  },

  exchange: {
    deadlineDays: 7,
    conditions: 'em até 7 dias após o recebimento, sem uso e com etiqueta',
  },

  catalog: {
    categories: ['Camisa', 'Polo', 'Tênis', 'Bermuda', 'Boné', 'Kits'],
    website: 'fluxooutlet.com.br',
    instagram: '@fluxooutlet',
  },

  priceRange: {
    bone: 'a partir de R$79',
    bermuda: 'a partir de R$149',
    camisa: 'a partir de R$89',
    polo: 'a partir de R$119',
    tenis: 'a partir de R$189',
    kit: 'a partir de R$299',
  },

  sizes: {
    clothing: ['P', 'M', 'G', 'GG'],
    footwear: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44'],
    guide: 'P (até 90cm peito), M (até 98cm), G (até 106cm), GG (até 114cm)',
  },
};

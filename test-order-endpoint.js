const axios = require('axios');

async function run() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const orderNumber = `TEST-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const payload = {
    operatorName: 'Admin',
    operatorId: '1',
    city: 'Padova',
    date: `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`,
    items: [
      {
        code: 'FA-001',
        name: 'Cerotti assortiti extra lunghi e descrizione che va su più righe per testare la spaziatura',
        location: 'Cassetta primo soccorso - Piano 1',
        reorderQty: 12,
        expiryDate: '2026-03-31',
        type: 'entrambi'
      },
      {
        code: 'FA-002',
        name: 'Disinfettante per cute con etichetta molto dettagliata che potrebbe andare su più righe',
        location: 'Magazzino - Scaffale B',
        reorderQty: 4,
        expiryDate: '2025-12-31',
        type: 'scadenza'
      }
    ]
  };

  try {
    const res = await axios.post('http://localhost:3000/orders/generate-pdf', payload);
    console.log('Status:', res.status);
    console.log('Data:', res.data);
  } catch (err) {
    console.error('Request failed:', err.response?.status, err.response?.data || err.message);
  }
}

run();
// netlify/functions/mandi.js
// Server-side function — fetches real UP mandi prices from data.gov.in
// Deployed free on Netlify — no CORS issues

const DATA_GOV_KEY = '579b464db66ec23bdd000001cdd3946e44ce4aab56adafd24e3d105';
const API_BASE = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';

// UP mandi names for filtering
const UP_MANDIS = [
  'Lucknow', 'Agra', 'Kanpur', 'Meerut', 'Varanasi', 'Allahabad', 'Prayagraj',
  'Gorakhpur', 'Bareilly', 'Moradabad', 'Aligarh', 'Mathura', 'Firozabad',
  'Muzaffarnagar', 'Saharanpur', 'Ghaziabad', 'Noida', 'Sitapur', 'Hardoi',
  'Barabanki', 'Unnao', 'Rae Bareli', 'Sultanpur', 'Faizabad', 'Azamgarh',
  'Jhansi', 'Banda', 'Hamirpur', 'Lalitpur', 'Etah', 'Mainpuri', 'Hathras',
  'Fatehpur', 'Pratapgarh', 'Mirzapur', 'Sonbhadra', 'Ballia', 'Deoria',
  'Basti', 'Gonda', 'Bahraich', 'Shravasti', 'Balrampur', 'Kushinagar',
];

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300', // cache 5 min
  };

  try {
    const today = new Date();
    // Try today first, then yesterday (data may not be published yet in morning)
    const dates = [0, 1, 2].map(offset => {
      const d = new Date(today);
      d.setDate(d.getDate() - offset);
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    });

    let allRecords = [];

    for (const dateStr of dates) {
      const encodedDate = encodeURIComponent(dateStr);
      const url = `${API_BASE}?api-key=${DATA_GOV_KEY}&format=json&limit=500&filters[State]=Uttar+Pradesh&filters[Arrival_Date]=${encodedDate}`;

      try {
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) continue;
        const data = await response.json();

        if (data && data.records && data.records.length > 0) {
          allRecords = data.records;
          break; // Got data for this date
        }
      } catch(e) {
        continue;
      }
    }

    // Also try without date filter for recent data
    if (allRecords.length === 0) {
      const url = `${API_BASE}?api-key=${DATA_GOV_KEY}&format=json&limit=500&filters[State]=Uttar+Pradesh`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const data = await response.json();
          if (data && data.records) allRecords = data.records;
        }
      } catch(e) {}
    }

    // Process records
    if (allRecords.length > 0) {
      const priceMap = processRecords(allRecords);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          source: 'live',
          timestamp: new Date().toISOString(),
          count: allRecords.length,
          prices: priceMap,
        }),
      };
    }

    // No data found
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ source: 'unavailable', prices: {} }),
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ source: 'error', error: err.message, prices: {} }),
    };
  }
};

function processRecords(records) {
  const nameMap = {
    'wheat': 'Wheat',       'gehun': 'Wheat',
    'barley': 'Barley',     'jau': 'Barley',
    'mustard': 'Mustard',   'sarson': 'Mustard', 'rapeseed': 'Mustard',
    'pea': 'Peas',          'matar': 'Peas',
    'gram': 'Gram',         'chana': 'Gram',     'chickpea': 'Gram',
    'lentil': 'Lentil',     'masur': 'Lentil',   'masoor': 'Lentil',
    'potato': 'Potato',     'aloo': 'Potato',
    'garlic': 'Garlic',     'lahsun': 'Garlic',
    'paddy': 'Paddy',       'dhan': 'Paddy',
    'maize': 'Maize',       'makka': 'Maize',
    'sugarcane': 'Sugarcane',
    'arhar': 'Arhar',       'tur': 'Arhar',
    'moong': 'Moong',       'green gram': 'Moong',
    'urad': 'Urad',         'black gram': 'Urad',
    'soyabean': 'Soyabean', 'soybean': 'Soyabean',
    'groundnut': 'Groundnut', 'moongphali': 'Groundnut',
    'sesamum': 'Sesame',    'til': 'Sesame',
    'onion': 'Onion',       'pyaz': 'Onion',
    'tomato': 'Tomato',
    'chilli': 'Chilli',     'mirch': 'Chilli',
    'turmeric': 'Turmeric', 'haldi': 'Turmeric',
    'coriander': 'Coriander',
    'cotton': 'Cotton',     'kapas': 'Cotton',
    'mentha': 'Mentha',     'mint': 'Mentha',
  };

  // Collect all prices per crop, then take modal average
  const pricesPerCrop = {};

  records.forEach(r => {
    try {
      const commodity = (r.Commodity || r.commodity || '').toLowerCase().trim();
      const modalPrice = parseFloat(r.Modal_Price || r.modal_price || r.ModalPrice || 0);
      if (!modalPrice || modalPrice <= 0) return;

      for (const [keyword, cropKey] of Object.entries(nameMap)) {
        if (commodity.includes(keyword)) {
          if (!pricesPerCrop[cropKey]) pricesPerCrop[cropKey] = [];
          pricesPerCrop[cropKey].push(modalPrice);
          break;
        }
      }
    } catch(e) {}
  });

  // Calculate median price for each crop (more stable than max/min)
  const result = {};
  for (const [cropKey, prices] of Object.entries(pricesPerCrop)) {
    if (prices.length === 0) continue;
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    result[cropKey] = prices.length % 2 !== 0
      ? prices[mid]
      : (prices[mid-1] + prices[mid]) / 2;
  }

  return result;
}

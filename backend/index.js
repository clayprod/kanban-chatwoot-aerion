const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: 'postgres',
  host: '10.0.1.11',
  database: 'tenryu',
  password: '36b27c2d33aa50e9a56d',
  port: 5432,
});

app.get('/api/contacts', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, custom_attributes, company_id FROM contacts');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/contacts/:id', async (req, res) => {
    const { id } = req.params;
    const { Funil_Vendas } = req.body;

    try {
        const { rows } = await pool.query(
            'SELECT custom_attributes FROM contacts WHERE id = $1',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const newCustomAttributes = { ...rows[0].custom_attributes, Funil_Vendas };

        await pool.query(
            'UPDATE contacts SET custom_attributes = $1 WHERE id = $2',
            [newCustomAttributes, id]
        );

        res.json({ message: 'Contact updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});

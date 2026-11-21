const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const db = require('./config/db');
const employeeRoutes = require('./routes/employeeRoutes');
const authRoutes = require('./routes/authRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const payrollRoutes = require('./routes/payrollRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
// Health check for the AWS load balancer (no database needed)
app.get('/health', (req, res) => res.status(200).send('OK'));

// Test Route & Database Check
app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS solution');
        res.json({ 
            success: true, 
            message: 'Connected to sweet_creatures database successfully!', 
            solution: rows[0].solution 
        });
    } catch (err) {
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    }
});

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use(express.static(path.resolve(__dirname, '../../frontend')));

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
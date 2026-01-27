

// // CORS ko update karein taaki frontend access kar sake
// app.use(cors({
//     origin: '*', // Production mein yahan apna frontend URL daal sakte hain
//     methods: ['GET', 'POST', 'PUT', 'DELETE'],
//     credentials: true
// }));

const express = require('express');
const mysql = require('mysql2'); 
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');


const app = express();
const PORT = process.env.PORT || 3000; // Render dynamic port use karega

// const app = express();
// const PORT = 3000;

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
// app.use(cors()); 
app.use(express.json());
app.use('/images', express.static('images'));




// Isse replace karein purane db connection ko:
const db = mysql.createConnection({
    host: 'b8mhbaxlcziqx6em6hcs-mysql.services.clever-cloud.com',
    user: 'uqdlz5m0drzwewfw',
    password: 'HAHTLJvqXayNXrS4Bj44', // Password field ke pass bane lock icon par click karke copy karein
    database: 'b8mhbaxlcziqx6em6hcs',
    port: 3306
});



// Reconnection logic (Cloud DBs aksar sleep mode mein chale jaate hain)
function handleDisconnect() {
    db.connect(err => {
        if (err) {
            console.error('❌ Error connecting to DB:', err);
            setTimeout(handleDisconnect, 2000); 
        } else {
            console.log('✅ Connected to Database');
        }
    });
}
handleDisconnect();
// const db = mysql.createConnection({
//     host: '127.0.0.1', 
//     user: 'root',
//     password: '', 
//     database: 'ramesh_jewellers_db',
//     port: 3308 
// });


db.connect(err => {
    if (err) console.error('❌ Cloud SQL Error:', err.message);
    else console.log('✅ Connected to Clever Cloud MySQL!');
});
// db.connect(err => {
//     if (err) console.error('❌ SQL Error:', err.message);
//     else console.log('✅ MySQL Connected');
// });

const storage = multer.diskStorage({
    destination: './images/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- 1. UPDATE RATES ---
app.post('/api/update-rates', (req, res) => {
    const { r995, r916, r750 } = req.body;
    const sql = "UPDATE settings SET rate_995=?, rate_916=?, rate_750=? WHERE id=1";
    db.query(sql, [r995, r916, r750], (err) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Rates Updated Successfully" });
    });
});

// --- 2. GET PRODUCTS (RAW DATA ONLY) ---
// Yahan humne calculation frontend (common.js) ke liye chhod di hai
app.get('/api/products', (req, res) => {
    db.query("SELECT * FROM settings WHERE id=1", (err, rateResult) => {
        if (err) return res.status(500).json(err);
        const rates = rateResult[0];

        db.query("SELECT * FROM products ORDER BY id DESC", (err, products) => {
            if (err) return res.status(500).json(err);

            // Sirf database ka raw data aur current gold rates bhej rahe hain
            res.json({ products: products, rates: rates });
        });
    });
});


// --- 3. ADD PRODUCT (WITH SIZE & MAKING) ---
app.post('/api/products', upload.single('productImage'), (req, res) => {
    const { name, weight_gm, making_charge, purity, size } = req.body; 
    const image = req.file ? req.file.filename : null;

    // Database mein basic details save kar rahe hain
    const sql = "INSERT INTO products (name, weight_gm, making_charge, purity, size, image) VALUES (?, ?, ?, ?, ?, ?)";
    
    db.query(sql, [name, weight_gm, making_charge, purity, size, image], (err, result) => {
        if (err) {
            console.error("❌ DB Insert Error:", err);
            return res.status(500).json(err);
        }
        res.json({ message: "Product added successfully with Size & Making!" });
    });
});

// --- 4. UPDATE PRODUCT ---
app.put('/api/products/:id', (req, res) => {
    const { name, weight_gm, making_charge, size, purity } = req.body;
    const sql = "UPDATE products SET name=?, weight_gm=?, making_charge=?, size=?, purity=? WHERE id=?";
    db.query(sql, [name, weight_gm, making_charge, size, purity, req.params.id], (err) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Updated Successfully" });
    });
});

app.delete('/api/:type/:id', (req, res) => {
    const { type, id } = req.params;
    
    // Sirf 'orders' aur 'products' table allow karne ke liye logic
    const tableName = type === 'orders' ? 'orders' : 'products';
    const sql = `DELETE FROM ${tableName} WHERE id = ?`;

    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error("DB Error:", err);
            return res.status(500).send("Database error: " + err.message);
        }
        if (result.affectedRows === 0) {
            return res.status(404).send("No data found in the database.");
        }
        res.send("Successfully deleted!");
    });
});

app.delete('/api/products/:id', (req, res) => {
    db.query("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Deleted" });
    });
});

// --- 6. ORDERS ---
app.post('/api/orders', (req, res) => {
    const { user_email, customer_name, items, total_amount, address, phone } = req.body;
    const itemsStr = JSON.stringify(items);
    const sql = "INSERT INTO orders (user_email, customer_name, items, total_amount, address, phone) VALUES (?,?,?,?,?,?)";
    db.query(sql, [user_email, customer_name, itemsStr, total_amount, address, phone], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, orderId: result.insertId });
    });
});

app.get('/api/orders', (req, res) => {
    db.query("SELECT * FROM orders ORDER BY id DESC", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});



// --- ADMIN LOGIN VERIFICATION ---
app.post('/api/admin/verify', (req, res) => {
    const { user, pass } = req.body;
    
    // Database se match kar rahe hain
    const sql = "SELECT * FROM admin_users WHERE username = ? AND password = ?";
    
    db.query(sql, [user, pass], (err, result) => {
        if (err) {
            console.error("Auth Error:", err);
            return res.status(500).json({ success: false, message: "Database Error" });
        }
        
        if (result.length > 0) {
            // Agar match ho gaya
            res.json({ success: true, message: "Access Granted" });
        } else {
            // Agar galat hai
            res.status(401).json({ success: false, message: "Invalid Credentials" });
        }
    });
});



// --- CHANGE ADMIN PASSWORD ---
app.post('/api/admin/change-password', (req, res) => {
    const { oldPass, newPass, newUser } = req.body;

    // Pehle purana password verify karte hain
    const checkSql = "SELECT * FROM admin_users WHERE password = ?";
    db.query(checkSql, [oldPass], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: "DB Error" });
        
        if (result.length > 0) {
            // Agar purana pass sahi hai, toh naya update karo
            const updateSql = "UPDATE admin_users SET username = ?, password = ? WHERE id = ?";
            db.query(updateSql, [newUser, newPass, result[0].id], (err2, result2) => {
                if (err2) return res.status(500).json({ success: false });
                res.json({ success: true, message: "Password Updated!" });
            });
        } else {
            res.status(401).json({ success: false, message: "Invalid email or password!" });
        }
    });
});



// --- ADVANCED SALES REPORT API ---
app.get('/api/admin/sales-report', (req, res) => {
    const { startDate, endDate } = req.query;
    let sql = `
        SELECT o.id AS order_id, o.customer_name, o.total_amount, o.order_date, o.status,
        GROUP_CONCAT(i.product_name SEPARATOR ', ') AS products
        FROM orders o
        JOIN order_items i ON o.id = i.order_id`;
    
    let params = [];
    if (startDate && endDate) {
        sql += ` WHERE DATE(o.order_date) BETWEEN ? AND ?`;
        params = [startDate, endDate];
    }
    
    sql += ` GROUP BY o.id ORDER BY o.order_date DESC`;

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});



// --- USER REGISTER (Ramesh Jewellers Customers) ---
app.post('/api/user/register', (req, res) => {
    const { name, email, password } = req.body;
    
    // Aapki table columns: full_name, email, password
    const sql = "INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)";
    
    db.query(sql, [name, email, password], (err, result) => {
        if (err) {
            console.error("❌ Registration Error:", err);
            // Agar email pehle se exist karta hai
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ success: false, message: "Email is already registered!" });
            }
            return res.status(500).json({ success: false, message: "Server Error" });
        }
        res.json({ success: true, message: "Account created successfully!" });
    });
});

// --- USER LOGIN ---
app.post('/api/user/login', (req, res) => {
    const { email, password } = req.body;
    
    const sql = "SELECT * FROM users WHERE email = ? AND password = ?";
    
    db.query(sql, [email, password], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: "Database Error" });
        
        if (result.length > 0) {
            // Login Success: User ka data bhej rahe hain (password chhod kar)
            const user = result[0];
            res.json({ 
                success: true, 
                message: "WELCOME!",
                user: {
                    id: user.id,
                    name: user.full_name,
                    email: user.email
                }
            });
        } else {
            res.status(401).json({ success: false, message: "Invalid email or password!" });
        }
    });
});



// --- GOOGLE AUTH SETUP ---
const client = new OAuth2Client('1057187594866-gsl08ba3pimkq6i1bc95c0g89mouv3qt.apps.googleusercontent.com');

// --- GOOGLE LOGIN ROUTE ---
app.post('/api/user/google-login', async (req, res) => {
    const { token } = req.body;

    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: '1057187594866-gsl08ba3pimkq6i1bc95c0g89mouv3qt.apps.googleusercontent.com',
        });
        
        const payload = ticket.getPayload();
        const { email, name } = payload;

        // DB Check
        const checkSql = "SELECT * FROM users WHERE email = ?";
        db.query(checkSql, [email], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: "DB Error" });

            if (result.length > 0) {
                const user = result[0];
                res.json({
                    success: true,
                    user: { id: user.id, name: user.full_name, email: user.email }
                });
            } else {
                const insertSql = "INSERT INTO users (full_name, email, password) VALUES (?, ?, 'GOOGLE_USER')";
                db.query(insertSql, [name, email], (err2, insertResult) => {
                    if (err2) return res.status(500).json({ success: false });
                    res.json({
                        success: true,
                        user: { id: insertResult.insertId, name: name, email: email }
                    });
                });
            }
        });

    } catch (error) {
        console.error("Google Error:", error);
        res.status(401).json({ success: false, message: "Invalid Google Token" });
    }
});


// Update Limited Offer Status
app.put('/api/products/toggle-offer/:id', (req, res) => {
    const { is_limited_offer } = req.body;
    const { id } = req.params; 
    
    const sql = "UPDATE products SET is_limited_offer = ? WHERE id = ?";
    db.query(sql, [is_limited_offer, id], (err, result) => {
        if (err) {
            console.error("❌ Toggle Error:", err);
            return res.status(500).json(err);
        }
        res.json({ message: "Offer status updated" });
    });
});




// --- NEW: Public Enquiry Submission (For Contact Page) ---
app.post('/api/enquiries', (req, res) => {
    const { name, email, phone, subject, message } = req.body;
    const sql = "INSERT INTO enquiries (name, email, phone, subject, message, status) VALUES (?, ?, ?, ?, ?, 'Pending')";
    
    db.query(sql, [name, email, phone, subject, message], (err, result) => {
        if (err) {
            console.error("❌ SQL Insert Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, message: "Enquiry saved!" });
    });
});

// 1. Saari enquiries fetch karne ke liye
app.get('/api/admin/enquiries', (req, res) => {
    db.query("SELECT * FROM enquiries ORDER BY created_at DESC", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// 2. Status update karne ke liye (Pending se Fixed karne ke liye)
app.post('/api/admin/update-enquiry-status', (req, res) => {
    const { id, status } = req.body;
    db.query("UPDATE enquiries SET status = ? WHERE id = ?", [status, id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Status Updated" });
    });
});

// 3. Enquiry delete karne ke liye
app.delete('/api/admin/delete-enquiry/:id', (req, res) => {
    db.query("DELETE FROM enquiries WHERE id = ?", [req.params.id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Deleted" });
    });
});


// Orders ka status update karne ke liye route (Add this in server.js)
app.post('/api/orders/update-status', (req, res) => {
    const { id, status } = req.body;
    db.query("UPDATE orders SET status = ? WHERE id = ?", [status, id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: "Order Status Updated" });
    });
});


// --- CAROUSEL UPDATE ROUTE ---
app.post('/api/update-carousel', upload.single('image'), (req, res) => {
    const { slide_num, title, description, tag } = req.body;
    const imagePath = req.file ? req.file.filename : null;

    // Agar image upload nahi ki, toh sirf text update karne ke liye logic
    if (!imagePath) {
        const sql = "UPDATE carousel_slides SET title=?, description=?, tag=? WHERE id=?";
        db.query(sql, [title, description, tag, slide_num], (err, result) => {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true, message: "Text Updated" });
        });
    } else {
        // Agar image hai, toh poora replace karo
        const sql = "REPLACE INTO carousel_slides (id, image_path, tag, title, description, is_active) VALUES (?, ?, ?, ?, ?, 1)";
        db.query(sql, [slide_num, imagePath, tag, title, description], (err, result) => {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true, message: "Slide Fully Updated" });
        });
    }
});

// --- GET CAROUSEL FOR FRONTEND ---
app.get('/api/carousel', (req, res) => {
    // Sirf wahi slides bhej rahe hain jo 'is_active = 1' hain
    db.query("SELECT * FROM carousel_slides WHERE is_active = 1 ORDER BY id ASC", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));


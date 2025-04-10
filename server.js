require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const apiRoutes = require('./routes/apiRoutes');
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger_output.json");



const PORT = process.env.PORT;
const DB_URL = process.env.DB_URL;

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));



mongoose.connect(DB_URL, {
}).then(() => console.log('successfully connected to database'))
  .catch((err) => console.log(err));

app.use('/api',apiRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use("/swagger", swaggerUi.serve, swaggerUi.setup(swaggerDocument));



app.listen(PORT, () =>{
   console.log(`Server running on http://localhost:${PORT}`);
   console.log(`Swagger UI available at http://localhost:${PORT}/swagger`);
});


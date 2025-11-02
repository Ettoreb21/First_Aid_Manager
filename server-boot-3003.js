process.env.PORT = '3003';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_SQLITE_PATH = './materials.sqlite';
require('./server.js');
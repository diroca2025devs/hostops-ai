-- Executado apenas na primeira inicialização do volume do MariaDB (docker-entrypoint-initdb.d).
-- Cria o banco exclusivo dos testes de integração e concede acesso ao usuário da aplicação.
CREATE DATABASE IF NOT EXISTS `hostops_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON `hostops_test`.* TO 'hostops'@'%';
FLUSH PRIVILEGES;

-- Initialize PostgreSQL database with UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create a function to generate UUIDs
CREATE OR REPLACE FUNCTION gen_random_uuid() 
RETURNS UUID AS $$
BEGIN
    RETURN uuid_generate_v4();
END;
$$ LANGUAGE plpgsql;

-- Create indexes for better performance
-- These will be created when tables are created by the application

-- Sample data for testing (optional - uncomment for demo purposes)
-- Note: These INSERT statements should only be used for development/demo

-- Sample Products
-- INSERT INTO products (name, description, price, stock_quantity, category) VALUES
-- ('Laptop Pro 15"', 'High-performance laptop with 16GB RAM and 512GB SSD', 1299.99, 50, 'Electronics'),
-- ('Wireless Mouse', 'Ergonomic wireless mouse with long battery life', 29.99, 200, 'Electronics'),
-- ('Mechanical Keyboard', 'RGB mechanical keyboard with blue switches', 89.99, 75, 'Electronics'),
-- ('4K Monitor', '27-inch 4K UHD monitor with HDR support', 399.99, 30, 'Electronics'),
-- ('USB-C Hub', '7-in-1 USB-C hub with HDMI, USB 3.0, SD card reader', 49.99, 150, 'Accessories');

-- Set proper permissions (if needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
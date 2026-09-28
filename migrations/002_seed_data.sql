-- ═══════════════════════════════════════════════════════════
-- Seed Data for City Markets
-- ═══════════════════════════════════════════════════════════

-- ══════════════════════════════════
-- BANNERS
-- ══════════════════════════════════
INSERT INTO banners (image_url, link_type, link_value, active, sort_order) VALUES
  ('https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&h=300&fit=crop', 'category', 'fruits-vegetables', true, 1),
  ('https://images.unsplash.com/photo-1604719312566-8912e9722e8f?w=800&h=300&fit=crop', 'none', null, true, 2),
  ('https://images.unsplash.com/photo-1585412727339-7159cf77a65e?w=800&h=300&fit=crop', 'category', 'dairy', true, 3);

-- ══════════════════════════════════
-- CATEGORIES
-- ══════════════════════════════════
INSERT INTO categories (name_ar, name_en, slug, icon_url, sort_order) VALUES
  ('فواكه وخضروات', 'Fruits & Vegetables', 'fruits-vegetables', '🥬', 1),
  ('ألبان وأجبان', 'Dairy & Cheese', 'dairy', '🧀', 2),
  ('لحوم ودواجن', 'Meat & Poultry', 'meat-poultry', '🍗', 3),
  ('مشروبات', 'Beverages', 'beverages', '🥤', 4),
  ('مخبوزات', 'Bakery', 'bakery', '🍞', 5),
  ('حلويات وشوكولاتة', 'Sweets & Chocolate', 'sweets', '🍫', 6),
  ('تنظيف ومنزلية', 'Cleaning & Home', 'cleaning', '🧹', 7),
  ('وجبات خفيفة', 'Snacks', 'snacks', '🍿', 8),
  ('أرز ومعكرونة', 'Rice & Pasta', 'rice-pasta', '🍝', 9),
  ('توابل وبهارات', 'Spices & Seasoning', 'spices', '🌶️', 10),
  ('زيوت وسمن', 'Oils & Ghee', 'oils', '🫒', 11),
  ('أغذية أطفال', 'Baby Food', 'baby-food', '🍼', 12);

-- ══════════════════════════════════
-- PRODUCTS
-- ══════════════════════════════════

-- Fruits & Vegetables
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit, is_featured)
SELECT id, 'طماطم طازجة كيلو', 'Fresh Tomatoes per KG', '1234567890', 'طماطم طازجة يومياً من المزارع المحلية', 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=400&h=400&fit=crop', 8.50, 6.50, 100, 'كيلو', true FROM categories WHERE slug = 'fruits-vegetables';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit, is_featured)
SELECT id, 'موز اكوادور كيلو', 'Ecuador Banana per KG', '1234567891', 'موز طازج من الإكوادور', 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&h=400&fit=crop', 7.00, 5.00, 80, 'كيلو', true FROM categories WHERE slug = 'fruits-vegetables';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit, is_featured)
SELECT id, 'خيار طازج كيلو', 'Fresh Cucumber per KG', '1234567892', 'خيار طازج محلي', 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=400&h=400&fit=crop', 5.00, 60, 'كيلو', false FROM categories WHERE slug = 'fruits-vegetables';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit, is_featured)
SELECT id, 'تفاح أخضر كيلو', 'Green Apple per KG', '1234567893', 'تفاح أخضر طازج', 'https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?w=400&h=400&fit=crop', 12.00, 9.50, 50, 'كيلو', true FROM categories WHERE slug = 'fruits-vegetables';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'بطاطس كيلو', 'Potatoes per KG', '1234567894', 'بطاطس طازجة', 'https://images.unsplash.com/photo-1518977676601-b53f82ber40?w=400&h=400&fit=crop', 4.00, 150, 'كيلو' FROM categories WHERE slug = 'fruits-vegetables';

-- Dairy
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit, is_featured)
SELECT id, 'حليب المراعي كامل الدسم 1لتر', 'Almarai Full Cream Milk 1L', '2345678901', 'حليب طازج كامل الدسم', 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&h=400&fit=crop', 12.00, 100, 'لتر', true FROM categories WHERE slug = 'dairy';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'جبن أبيض 400جم', 'White Cheese 400g', '2345678902', 'جبن أبيض طري', 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=400&h=400&fit=crop', 14.00, 45, 'علبة' FROM categories WHERE slug = 'dairy';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit, is_featured)
SELECT id, 'زبادي المراعي 180جم', 'Almarai Yogurt 180g', '2345678903', 'زبادي طازج', 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&h=400&fit=crop', 3.50, 2.50, 200, 'كوب', true FROM categories WHERE slug = 'dairy';

-- Meat & Poultry
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit, is_featured)
SELECT id, 'دجاج كامل طازج', 'Fresh Whole Chicken', '3456789012', 'دجاج طازج كامل', 'https://images.unsplash.com/photo-1587593819181-38a4591c5f5b?w=400&h=400&fit=crop', 22.00, 18.00, 30, 'حبة', true FROM categories WHERE slug = 'meat-poultry';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'لحم غنم كيلو', 'Lamb Meat per KG', '3456789013', 'لحم غنم طازج', 'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=400&h=400&fit=crop', 65.00, 20, 'كيلو' FROM categories WHERE slug = 'meat-poultry';

-- Beverages
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'بيبسي علبة 330مل', 'Pepsi Can 330ml', '4567890123', 'مشروب غازي بيبسي', 'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?w=400&h=400&fit=crop', 2.50, 300, 'علبة' FROM categories WHERE slug = 'beverages';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'عصير برتقال طبيعي 1لتر', 'Natural Orange Juice 1L', '4567890124', 'عصير برتقال طبيعي 100%', 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=400&h=400&fit=crop', 11.00, 80, 'لتر' FROM categories WHERE slug = 'beverages';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit, is_featured)
SELECT id, 'مياه معدنية 6 عبوات', 'Mineral Water 6 Pack', '4567890125', 'مياه معدنية نقية', 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400&h=400&fit=crop', 8.00, 6.00, 500, 'باك', true FROM categories WHERE slug = 'beverages';

-- Bakery
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit, is_featured)
SELECT id, 'خبز عربي ربطة', 'Arabic Bread Bundle', '5678901234', 'خبز عربي طازج يومياً', 'https://images.unsplash.com/photo-1586444833468-7a9258d5c98b?w=400&h=400&fit=crop', 5.00, 3.50, 50, 'ربطة', true FROM categories WHERE slug = 'bakery';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'توست أبيض', 'White Toast Bread', '5678901235', 'خبز توست أبيض طري', 'https://images.unsplash.com/photo-1589367920969-ab8e050bbb04?w=400&h=400&fit=crop', 7.00, 60, 'كيس' FROM categories WHERE slug = 'bakery';

-- Sweets
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit, is_featured)
SELECT id, 'شوكولاتة فاخرة', 'Premium Chocolate', '6789012345', 'شوكولاتة بلجيكية فاخرة', 'https://images.unsplash.com/photo-1481391319761-50e756a24696?w=400&h=400&fit=crop', 15.00, 12.00, 40, 'حبة', true FROM categories WHERE slug = 'sweets';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'بسكويت شاي', 'Tea Biscuits', '6789012346', 'بسكويت شاي مقرمش', 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&h=400&fit=crop', 6.00, 70, 'علبة' FROM categories WHERE slug = 'sweets';

-- Cleaning
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, discount_price, stock_qty, unit)
SELECT id, 'صابون أطباق 1لتر', 'Dish Soap 1L', '7890123456', 'صابون أطباق سائل', 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=400&h=400&fit=crop', 11.00, 9.00, 80, 'عبوة' FROM categories WHERE slug = 'cleaning';

-- Snacks
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'شيبس ليز كبير', 'Lays Chips Large', '8901234567', 'شيبس بطاطس مقرمش', 'https://images.unsplash.com/photo-1566478989037-e61aa9b449e3?w=400&h=400&fit=crop', 8.00, 150, 'كيس' FROM categories WHERE slug = 'snacks';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'مكسرات مشكلة 200جم', 'Mixed Nuts 200g', '8901234568', 'مكسرات مشكلة محمصة', 'https://images.unsplash.com/photo-1599599810694-b5b37304c041?w=400&h=400&fit=crop', 25.00, 35, 'كيس' FROM categories WHERE slug = 'snacks';

-- Rice & Pasta
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit, is_featured)
SELECT id, 'رز بسمتي هندي 5كجم', 'Indian Basmati Rice 5kg', '9012345678', 'أرز بسمتي هندي فاخر', 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=400&fit=crop', 38.00, 60, 'كيس', true FROM categories WHERE slug = 'rice-pasta';

INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'مكرونة اسباجيتي 500جم', 'Spaghetti Pasta 500g', '9012345679', 'مكرونة اسباجيتي إيطالية', 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=400&h=400&fit=crop', 5.50, 90, 'كيس' FROM categories WHERE slug = 'rice-pasta';

-- Spices
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'بهارات كبسة', 'Kabsa Spice Mix', '0123456789', 'خلطة بهارات كبسة جاهزة', 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=400&h=400&fit=crop', 9.00, 45, 'علبة' FROM categories WHERE slug = 'spices';

-- Oils
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'زيت زيتون بكر 1لتر', 'Extra Virgin Olive Oil 1L', '1122334455', 'زيت زيتون بكر ممتاز', 'https://images.unsplash.com/photo-1474979266404-7f28db0add1c?w=400&h=400&fit=crop', 35.00, 25, 'لتر' FROM categories WHERE slug = 'oils';

-- Baby Food
INSERT INTO products (category_id, name_ar, name_en, barcode, description, image_url, price, stock_qty, unit)
SELECT id, 'حليب أطفال 400جم', 'Baby Formula 400g', '2233445566', 'حليب أطفال من عمر سنة', 'https://images.unsplash.com/photo-1584844650174-0f6b1e6393ae?w=400&h=400&fit=crop', 55.00, 20, 'علبة' FROM categories WHERE slug = 'baby-food';

-- ══════════════════════════════════
-- SAMPLE ADMIN USER (for testing)
-- ══════════════════════════════════
INSERT INTO users (phone, name, email, loyalty_points, loyalty_tier, spin_count_today)
VALUES ('+966551234567', 'أحمد محمد', 'admin@citymarkets.sa', 1250, 'silver', 0);

-- ══════════════════════════════════
-- SAMPLE COUPONS
-- ══════════════════════════════════
INSERT INTO coupons (code, type, value, min_order, source, expires_at, is_active) VALUES
  ('WELCOME10', 'percentage', 10, 50, 'admin', NOW() + INTERVAL '30 days', true),
  ('FREEDEL', 'free_delivery', 0, 0, 'admin', NOW() + INTERVAL '15 days', true),
  ('SAVE5', 'fixed', 5, 30, 'admin', NOW() + INTERVAL '60 days', true);

-- ══════════════════════════════════
-- UPDATE STATS
-- ══════════════════════════════════
ANALYZE;

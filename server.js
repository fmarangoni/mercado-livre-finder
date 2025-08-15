// server.js

// Import required modules
const express = require('express');
const puppeteer = require('puppeteer'); // To control a headless Chrome browser
const cheerio = require('cheerio'); // To parse the HTML and scrape data
const cors = require('cors'); // To handle CORS policy

// Create an Express application
const app = express();
const PORT = 3000;

// --- Middleware ---
// Enable CORS for all routes, allowing our front-end to communicate with this server
app.use(cors());

// --- Helper function to handle all popups and overlays ---
async function handlePopupsAndOverlays(page) {
    console.log('Checking for and handling popups/overlays...');
    
    // List of common popup selectors for Mercado Livre
    const popupSelectors = [
        // Cookie consent
        'button[data-testid="action:understood-button"]',
        'button[data-testid="cookie-consent-banner-opt-out"]',
        '.cookie-consent-banner-opt-out',
        
        // Location/shipping popup
        'button[data-testid="modal-close-button"]',
        '.andes-modal__close',
        'button[aria-label="Cerrar"]',
        'button[aria-label="Close"]',
        
        // App download promotion
        '.onboarding-cp-wrapper button',
        'button[data-testid="onboarding-cp-understand"]',
        
        // Generic close buttons
        'button[class*="close"]',
        '[data-testid*="close"]',
        '.ui-modal-close',
        
        // Location selection modal
        'button[data-testid="action:modal-close"]',
        '.shipping-location button',
        
        // Any button with "Entendi", "OK", "Fechar" text
        'button:contains("Entendi")',
        'button:contains("OK")',
        'button:contains("Fechar")',
        'button:contains("Cerrar")',
        
        // Overlay backgrounds (clickable to close)
        '.andes-modal-overlay',
        '.ui-modal-overlay'
    ];
    
    let popupsFound = 0;
    
    for (const selector of popupSelectors) {
        try {
            // Wait a bit for potential animations
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Check if element exists and is visible
            const element = await page.$(selector);
            if (element) {
                const isVisible = await element.isVisible();
                if (isVisible) {
                    console.log(`Found visible popup with selector: ${selector}`);
                    await element.click();
                    console.log(`Clicked popup: ${selector}`);
                    popupsFound++;
                    
                    // Wait a bit for the popup to close
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            // Ignore errors for individual selectors, continue with next
            console.log(`Could not interact with selector ${selector}: ${error.message}`);
        }
    }
    
    // Handle popups by text content (for buttons with specific text)
    try {
        const textBasedSelectors = [
            { text: 'Entendi', description: 'Understood button' },
            { text: 'OK', description: 'OK button' },
            { text: 'Fechar', description: 'Close button' },
            { text: 'Aceitar', description: 'Accept button' },
            { text: 'Continuar', description: 'Continue button' }
        ];
        
        for (const { text, description } of textBasedSelectors) {
            try {
                await page.evaluate((buttonText) => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const button = buttons.find(btn => 
                        btn.textContent.trim().toLowerCase().includes(buttonText.toLowerCase())
                    );
                    if (button && button.offsetParent !== null) { // Check if visible
                        button.click();
                        return true;
                    }
                    return false;
                }, text);
                
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.log(`Could not click button with text "${text}": ${error.message}`);
            }
        }
    } catch (error) {
        console.log(`Error in text-based popup handling: ${error.message}`);
    }
    
    console.log(`Popup handling complete. Found and handled ${popupsFound} popups.`);
    return popupsFound;
}

// --- Helper function to wait for page to be ready ---
async function waitForPageReady(page, maxAttempts = 3) {
    const resultsContainerSelector = 'ol.ui-search-layout';
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`Attempt ${attempt}: Waiting for search results container...`);
            
            // Wait for the main container
            await page.waitForSelector(resultsContainerSelector, { timeout: 30000 });
            
            // Additional check: wait for at least one product item
            await page.waitForSelector('.ui-search-layout__item', { timeout: 10000 });
            
            // Check if we have actual content (not just loading state)
            const hasProducts = await page.evaluate(() => {
                const items = document.querySelectorAll('.ui-search-layout__item');
                return items.length > 0;
            });
            
            if (hasProducts) {
                console.log(`Page ready on attempt ${attempt}. Found product listings.`);
                return true;
            } else {
                console.log(`Attempt ${attempt}: Container found but no products yet. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
        } catch (error) {
            console.log(`Attempt ${attempt} failed: ${error.message}`);
            if (attempt < maxAttempts) {
                console.log('Retrying...');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }
    
    throw new Error('Failed to load search results after multiple attempts');
}

// --- Routes ---
// Define a GET route for '/search'
app.get('/search', async (req, res) => {
    const searchQuery = req.query.q;

    if (!searchQuery) {
        return res.status(400).json({ error: 'Search query parameter "q" is required.' });
    }

    const searchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(searchQuery)}`;
    console.log(`--- Starting new search for: "${searchQuery}" ---`);
    console.log(`Navigating to URL: ${searchUrl}`);

    let browser = null;
    try {
        console.log('Step 1: Launching browser...');
        browser = await puppeteer.launch({
            headless: false, // Set to true in production
            slowMo: 50,      // Reduced from 90ms for better performance
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled', // Avoid detection
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        });
        
        const page = await browser.newPage();
        
        // Set user agent to avoid bot detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        console.log('Step 2: Navigating to search page...');
        await page.goto(searchUrl, { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });

        console.log('Step 3: Initial page load complete, handling popups...');
        
        // Handle initial popups immediately after page load
        await handlePopupsAndOverlays(page);
        
        // Wait a bit more for any delayed popups
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Handle any remaining popups
        await handlePopupsAndOverlays(page);

        console.log('Step 4: Waiting for page to be ready...');
        await waitForPageReady(page);

        // Optional: Pause for viewing if needed (remove in production)
        if (process.env.NODE_ENV !== 'production') {
            console.log('Pausing for 3 seconds for viewing...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log('Step 5: Page is ready for scraping, extracting content...');
        const content = await page.content();
        const $ = cheerio.load(content);

        const products = [];
        console.log('Step 6: Parsing products...');

        // Improved product parsing with better error handling
        $('.ui-search-layout__item').each((index, element) => {
            try {
                const productElement = $(element);

                // Skip sponsored items
                if (productElement.find('.ui-search-item--ad').length > 0) {
                    console.log(`Skipping sponsored item ${index + 1}`);
                    return;
                }

                // Try multiple selectors for title (corrected based on actual HTML structure)
                let title = productElement.find('a.poly-component__title').text().trim() ||
                           productElement.find('.poly-component__title-wrapper a').text().trim() ||
                           productElement.find('.ui-search-item__title').text().trim() ||
                           productElement.find('h3 a').text().trim() ||
                           productElement.find('h2 a').text().trim();


                // Price extraction with better handling
                const priceFraction = productElement.find('.andes-money-amount__fraction').first().text().replace(/\./g, '').replace(/,/g, '');
                const priceCents = productElement.find('.andes-money-amount__cents').first().text() || '00';
                
                // Link extraction with fallback (corrected based on actual HTML structure)
                let permalink = productElement.find('a.poly-component__title').attr('href') ||
                               productElement.find('.poly-component__title-wrapper a').attr('href') ||
                               productElement.find('a.ui-search-link').attr('href') ||
                               productElement.find('a[href*="/MLB"]').attr('href');
                
                // Make sure the link is absolute
                if (permalink && !permalink.startsWith('http')) {
                    permalink = `https://www.mercadolivre.com.br${permalink}`;
                }

                // Image extraction with multiple fallbacks
                let thumbnail = productElement.find('img.ui-search-result-image__element').attr('data-src') ||
                               productElement.find('img.ui-search-result-image__element').attr('src') ||
                               productElement.find('img').attr('data-src') ||
                               productElement.find('img').attr('src');

                let price = 0;
                if (priceFraction) {
                    price = parseFloat(`${priceFraction}.${priceCents}`);
                }


                // Only add products with all required fields
                if (title && price > 0 && permalink && thumbnail) {
                    products.push({ 
                        title: title.substring(0, 200), // Limit title length
                        price, 
                        permalink, 
                        thumbnail 
                    });
                    console.log(`Product ${index + 1} title:`, title + ` price: - ${price}` + ` URL: - ${permalink}`);
                } else {
                    console.log(`Skipping incomplete product ${index + 1}:`, {
                        hasTitle: !!title,
                        hasPrice: price > 0,
                        hasPermalink: !!permalink,
                        hasThumbnail: !!thumbnail
                    });
                }
            } catch (error) {
                console.error(`Error parsing product ${index + 1}:`, error.message);
            }
        });

        console.log(`Step 7: Finished parsing. Found ${products.length} valid products.`);

        if (products.length > 0) {
            res.json(products);
        } else {
            console.log('Warning: No products were successfully parsed.');
            
            // Debug: Save HTML for inspection
            if (process.env.NODE_ENV !== 'production') {
                const fs = require('fs');
                fs.writeFileSync('debug_page.html', content);
                console.log('Saved page HTML to debug_page.html for inspection');
            }
            
            res.json([]);
        }

    } catch (error) {
        console.error('--- AN ERROR OCCURRED ---');
        console.error('Error details:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'An internal server error occurred during scraping.',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Check server logs'
        });
    } finally {
        if (browser) {
            console.log('Step 8: Closing browser.');
            await browser.close();
        }
        console.log('--- Search finished ---');
    }
});

// --- Health check endpoint ---
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- Start the server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Ready to scrape Mercado Livre with enhanced popup handling.');
    console.log('Endpoints:');
    console.log(`  GET /search?q=<query> - Search products`);
    console.log(`  GET /health - Health check`);
});
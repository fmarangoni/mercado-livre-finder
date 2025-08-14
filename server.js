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

// --- Routes ---
// Define a GET route for '/search'
app.get('/search', async (req, res) => {
    const searchQuery = req.query.q || 'iPhone'; // Default to iPhone if no query provided

    const searchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(searchQuery)}`;
    console.log(`--- Starting new search for: "${searchQuery}" ---`);
    console.log(`Navigating to URL: ${searchUrl}`);

    let browser = null;
    try {
        // --- UPDATED PUPPETEER LAUNCH OPTIONS FOR DEBUGGING ---
        console.log('Step 1: Launching browser...');
        browser = await puppeteer.launch({
            headless: false, // <-- SET TO FALSE TO SHOW THE BROWSER WINDOW
            slowMo: 50,      // <-- Slows down Puppeteer operations by 50ms to make it easier to see what's happening
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 }); // Set a standard viewport size

        console.log('Step 2: Navigating to page...');
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('Page navigation complete.');

        // --- NEW: HANDLE COOKIE CONSENT BANNER ---
        //console.log('Step 2.5: Checking for cookie consent banner...');
        //const cookieButtonSelector = 'button[data-testid="action:understood-button"]';
       // try {
       //     await page.waitForSelector(cookieButtonSelector, { timeout: 5000 }); // Wait up to 5 seconds for the button
       //     await page.click(cookieButtonSelector);
       //     console.log('Cookie consent button found and clicked.');
       // } catch (e) {
       //     console.log('Cookie consent button not found, proceeding...');
       // }

        // --- NEW: HANDLE CEP POPUP ---
        console.log('Step 2.7: Checking for CEP popup...');
        try {

            // Wait for the CEP button to appear
            const cepButtonSelector = 'button[data-testid="action:shipping-calculator-button"]';
            await page.waitForSelector(cepButtonSelector, { timeout: 1000000000 });
            console.log('CEP button found, clicking...');
            await page.click(cepButtonSelector);
            
            // Wait for the CEP input field to appear
            const cepInputSelector = 'input[data-testid="shipping-calculator-zipcode-input"]';
            await page.waitForSelector(cepInputSelector, { timeout: 5000 });
            console.log('CEP input field found, entering postal code...');
            
            // Clear the input field and type the CEP
            await page.click(cepInputSelector, { clickCount: 3 }); // Select all text
            await page.type(cepInputSelector, '06454-020');
            
            // Click the confirm button
            const confirmButtonSelector = 'button[data-testid="shipping-calculator-calculate-button"]';
            await page.waitForSelector(confirmButtonSelector, { timeout: 5000 });
            await page.click(confirmButtonSelector);
            console.log('CEP set to 06454-020 successfully.');
            
            // Wait a moment for the page to update with the new location
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (e) {
            console.log('CEP popup not found or error handling it:', e.message);
        }

        // --- MORE ROBUST SELECTOR WAITING ---
        // We will wait for the main container that holds all the search results.
        const resultsContainerSelector = 'ol.ui-search-layout';
        console.log(`Step 3: Waiting for selector "${resultsContainerSelector}" to appear...`);

        await page.waitForSelector(resultsContainerSelector, { timeout: 30000 });
        console.log('Selector found! Page is ready for scraping.');

        // --- CORRECTED PAUSE FOR VIEWING ---
        console.log('Pausing for 5 seconds for viewing...');
        await new Promise(resolve => setTimeout(resolve, 50000)); // Correct way to pause

        const content = await page.content();
        const $ = cheerio.load(content);

        const products = [];
        console.log('Step 4: Parsing page and iterating over products...');

        // The selector for individual items within the list.
        $('.ui-search-layout__item').each((index, element) => {
            const productElement = $(element);

            // Skip sponsored items
            if (productElement.find('.ui-search-item--ad').length > 0) {
                return;
            }

            const title = productElement.find('h2.ui-search-item__title').text().trim();
            const priceFraction = productElement.find('.andes-money-amount__fraction').first().text().replace(/\./g, '').replace(/,/g, '');
            const priceCents = productElement.find('.andes-money-amount__cents').first().text() || '00';
            const permalink = productElement.find('a.ui-search-link').attr('href');
            const thumbnail = productElement.find('img.ui-search-result-image__element').attr('data-src') || productElement.find('img.ui-search-result-image__element').attr('src');
            
            let price = 0;
            if (priceFraction) {
                 price = parseFloat(`${priceFraction}.${priceCents}`);
            }

            if (title && price > 0 && permalink && thumbnail) {
                products.push({ title, price, permalink, thumbnail });
            }
        });

        console.log(`Step 5: Finished parsing. Found ${products.length} products.`);

        if (products.length > 0) {
            res.json(products);
        } else {
            console.log('Warning: No products were successfully parsed. The HTML structure may have changed, or the page did not contain product listings.');
            res.json([]);
        }

    } catch (error) {
        console.error('--- AN ERROR OCCURRED ---');
        console.error('Error during web scraping process:', error.message);
        res.status(500).json({ error: 'An internal server error occurred during scraping. Check the server console for details.' });
    } finally {
        if (browser) {
            console.log('Step 6: Closing browser.');
            await browser.close();
        }
        console.log('--- Search finished ---');
    }
});

// --- NEW: Mock iPhone search endpoint ---
app.get('/mock-iphone-search', async (req, res) => {
    console.log('--- Starting mock iPhone search ---');
    
    // Simulate calling the search endpoint with iPhone query
    try {
        const searchUrl = `http://localhost:${PORT}/search?q=iPhone`;
        console.log(`Making internal request to: ${searchUrl}`);
        
        // For demonstration, we'll just return a mock response
        // In a real scenario, you could make an actual HTTP request to your own endpoint
        const mockResponse = {
            message: 'Mock iPhone search initiated',
            searchQuery: 'iPhone',
            cepSet: '06454-020',
            note: 'This would trigger the actual scraping with CEP popup handling'
        };
        
        res.json(mockResponse);
        
    } catch (error) {
        console.error('Error in mock iPhone search:', error.message);
        res.status(500).json({ error: 'Mock search failed' });
    }
});

// --- Start the server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Ready to scrape Mercado Livre (in visible browser mode).');
    console.log('Endpoints:');
    console.log(`  - GET /search?q=<query> - Search for products`);
    console.log(`  - GET /mock-iphone-search - Mock iPhone search with CEP handling`);
});

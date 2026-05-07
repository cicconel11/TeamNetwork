const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Configuration
const SRC_DIR = path.join(__dirname, '../../src');
const APP_DIR = path.join(SRC_DIR, 'app');

// Route patterns for Next.js App Router
const ROUTE_PATTERNS = [
  // Static routes: page.tsx, layout.tsx
  '**/page.tsx',
  '**/layout.tsx',
  // Dynamic routes: [param]/page.tsx
  '**/[[]*[]]/page.tsx',
  '**/[[]*[]]/layout.tsx',
  // API routes
  '**/route.ts',
  '**/route.js'
];

// Link patterns to search for
const LINK_PATTERNS = [
  // Next.js Link href
  /href=\{["']([^"']+)["']\}/g,
  // window.location, router.push, etc.
  /router\.push\(["']([^"']+)["']\)/g,
  /router\.replace\(["']([^"']+)["']\)/g,
  /window\.location\.href\s*=\s*["']([^"']+)["']/g,
  /window\.location\.assign\(["']([^"']+)["']\)/g,
  // Hardcoded <a href>
  /<a[^>]+href=["']([^"']+)["'][^>]*>/g,
  // Next.js Link component (simplified)
  /<Link[^>]+href=\{["']([^"']+)["']\}[^>]*>/g
];

/**
 * Extract routes from Next.js App Router directory structure
 */
function extractRoutes() {
  const routes = new Set();

  // Find all route files
  const routeFiles = glob.sync(ROUTE_PATTERNS, {
    cwd: APP_DIR,
    absolute: true
  });

  for (const filePath of routeFiles) {
    // Convert file path to route
    let route = path.relative(APP_DIR, filePath)
      .replace(/\/page\.tsx?$/, '')  // Remove page.tsx
      .replace(/\/layout\.tsx?$/, '') // Remove layout.tsx
      .replace(/\/route\.(ts|js)$/, '') // Remove route.ts/js
      .replace(/\[([^\]]+)\]/g, ':$1') // Convert [param] to :param
      .replace(/\[\.\.\.([^\]]+)\]/g, ':$1*'); // Convert [...param] to :param*

    // Handle root route
    if (!route) route = '/';

    routes.add(route);
  }

  return Array.from(routes).sort();
}

/**
 * Extract hardcoded links from source files
 */
function extractHardcodedLinks() {
  const links = new Set();
  const files = [];

  // Find all TypeScript/JavaScript files
  const tsFiles = glob.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: SRC_DIR,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
  });

  for (const filePath of tsFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(process.cwd(), filePath);

      for (const pattern of LINK_PATTERNS) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const link = match[1];

          // Skip external URLs and dynamic expressions
          if (link.startsWith('http') || link.startsWith('//') ||
              link.includes('${') || link.includes('`') ||
              link.startsWith('mailto:') || link.startsWith('tel:')) {
            continue;
          }

          // Normalize relative links
          let normalizedLink = link;
          if (normalizedLink.startsWith('./')) {
            normalizedLink = normalizedLink.substring(2);
          }
          if (normalizedLink.startsWith('../')) {
            // This is complex to resolve statically, so we'll keep as-is
            normalizedLink = link;
          }

          links.add(normalizedLink);
          files.push({
            file: relativePath,
            link: link,
            normalizedLink: normalizedLink,
            pattern: pattern.source
          });
        }
      }
    } catch (error) {
      console.warn(`Error reading file ${filePath}:`, error.message);
    }
  }

  return {
    uniqueLinks: Array.from(links).sort(),
    detailedLinks: files
  };
}

/**
 * Compare static inventory with crawler results
 */
function compareWithCrawler(staticRoutes, staticLinks, crawlerResults = null) {
  const comparison = {
    routesDefinedButNeverVisited: [],
    linksReferencedButMissingRoutes: [],
    routesVisitedButNotDefined: [],
    linksVisitedButNotReferenced: []
  };

  if (!crawlerResults || !crawlerResults.results) {
    console.log('No crawler results provided for comparison');
    return comparison;
  }

  const visitedUrls = new Set(crawlerResults.results.map(r => r.url));

  // Routes defined but never visited
  for (const route of staticRoutes) {
    const routeExists = Array.from(visitedUrls).some(visited =>
      visited.includes(route) || route.includes(visited.split('?')[0])
    );
    if (!routeExists) {
      comparison.routesDefinedButNeverVisited.push(route);
    }
  }

  // Links referenced but missing routes (simplified check)
  for (const link of staticLinks.uniqueLinks) {
    if (!link.startsWith('/') || link === '/' || link.startsWith('#')) continue;

    const routeExists = staticRoutes.some(route =>
      route === link || route.startsWith(link.split('/')[1])
    );

    if (!routeExists && !staticRoutes.includes(link)) {
      comparison.linksReferencedButMissingRoutes.push(link);
    }
  }

  return comparison;
}

/**
 * Generate report
 */
function generateReport(staticRoutes, staticLinks, comparison) {
  const report = {
    timestamp: new Date().toISOString(),
    staticRoutes: staticRoutes,
    staticLinks: staticLinks,
    comparison: comparison
  };

  // Write JSON report
  fs.writeFileSync(
    path.join(process.cwd(), 'audit', 'static-inventory.json'),
    JSON.stringify(report, null, 2)
  );

  // Generate markdown report
  const md = `# Static Route Inventory Report

Generated on ${report.timestamp}

## Routes Found (${staticRoutes.length})

${staticRoutes.map(route => `- \`${route}\``).join('\n')}

## Hardcoded Links Found (${staticLinks.uniqueLinks.length})

${staticLinks.uniqueLinks.map(link => `- \`${link}\``).join('\n')}

## Link Details

${staticLinks.detailedLinks.slice(0, 50).map(link =>
  `- **${link.file}**: \`${link.link}\` (${link.pattern})`
).join('\n')}

${staticLinks.detailedLinks.length > 50 ? `\n... and ${staticLinks.detailedLinks.length - 50} more links` : ''}

## Comparison with Crawler Results

${comparison.routesDefinedButNeverVisited.length > 0 ? `
### Routes Defined but Never Visited (${comparison.routesDefinedButNeverVisited.length})

${comparison.routesDefinedButNeverVisited.map(route => `- \`${route}\``).join('\n')}
` : '### Routes Defined but Never Visited\n\nNone found - all defined routes were visited! 🎉'}

${comparison.linksReferencedButMissingRoutes.length > 0 ? `
### Links Referenced but Routes Missing (${comparison.linksReferencedButMissingRoutes.length})

${comparison.linksReferencedButMissingRoutes.map(link => `- \`${link}\``).join('\n')}
` : '### Links Referenced but Routes Missing\n\nNone found - all referenced links have corresponding routes! 🎉'}

---
*Report generated by static route inventory scanner*
`;

  fs.writeFileSync(
    path.join(process.cwd(), 'audit', 'static-inventory.md'),
    md
  );

  return report;
}

// Main execution
function main() {
  console.log('🔍 Scanning static routes and links...');

  // Ensure audit directory exists
  const auditDir = path.join(process.cwd(), 'audit');
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }

  // Extract routes
  const staticRoutes = extractRoutes();
  console.log(`📁 Found ${staticRoutes.length} routes`);

  // Extract links
  const staticLinks = extractHardcodedLinks();
  console.log(`🔗 Found ${staticLinks.uniqueLinks.length} unique hardcoded links`);
  console.log(`📄 Found ${staticLinks.detailedLinks.length} total link references`);

  // Load crawler results if available
  let crawlerResults = null;
  const crawlerReportPath = path.join(auditDir, 'ui_report.json');
  if (fs.existsSync(crawlerReportPath)) {
    try {
      crawlerResults = JSON.parse(fs.readFileSync(crawlerReportPath, 'utf-8'));
      console.log('📊 Loaded UI crawler results for comparison');
    } catch (error) {
      console.warn('Could not load UI crawler results:', error.message);
    }
  }

  // Compare and generate report
  const comparison = compareWithCrawler(staticRoutes, staticLinks, crawlerResults);
  const report = generateReport(staticRoutes, staticLinks, comparison);

  console.log('✅ Static inventory report generated!');
  console.log(`   📄 Routes: ${staticRoutes.length}`);
  console.log(`   🔗 Links: ${staticLinks.uniqueLinks.length}`);
  console.log(`   ⚠️  Missing routes: ${comparison.linksReferencedButMissingRoutes.length}`);
  console.log(`   ⚠️  Unvisited routes: ${comparison.routesDefinedButNeverVisited.length}`);

  return report;
}

if (require.main === module) {
  main();
}

module.exports = { main, extractRoutes, extractHardcodedLinks };

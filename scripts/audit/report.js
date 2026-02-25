const fs = require('fs');
const path = require('path');

/**
 * Report Compilation Script
 *
 * Combines all audit reports into comprehensive summaries
 */

function loadReport(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (error) {
    console.warn(`Could not load ${filePath}:`, error.message);
  }
  return null;
}

function combineReports() {
  const auditDir = path.join(process.cwd(), 'audit');

  // Load individual reports
  const uiReport = loadReport(path.join(auditDir, 'report.json'));
  const staticReport = loadReport(path.join(auditDir, 'static-inventory.json'));
  const backendReport = loadReport(path.join(auditDir, 'backend_report.json'));

  const combined = {
    timestamp: new Date().toISOString(),
    summary: {
      ui: uiReport ? {
        totalPages: uiReport.summary.totalPages,
        successfulPages: uiReport.summary.successfulPages,
        failedPages: uiReport.summary.failedPages,
        consoleErrors: uiReport.summary.totalConsoleErrors,
        networkErrors: uiReport.summary.totalNetworkErrors,
        blockedRequests: uiReport.summary.blockedRequests
      } : null,
      static: staticReport ? {
        routes: staticReport.staticRoutes.length,
        links: staticReport.staticLinks.uniqueLinks.length,
        unvisitedRoutes: staticReport.comparison.routesDefinedButNeverVisited.length,
        missingRoutes: staticReport.comparison.linksReferencedButMissingRoutes.length
      } : null,
      backend: backendReport ? {
        totalIssues: backendReport.summary.totalIssues,
        highSeverity: backendReport.summary.highSeverity,
        mediumSeverity: backendReport.summary.mediumSeverity,
        lowSeverity: backendReport.summary.lowSeverity,
        recommendations: backendReport.summary.totalRecommendations
      } : null
    },
    reports: {
      ui: uiReport,
      static: staticReport,
      backend: backendReport
    }
  };

  return combined;
}

function generateCombinedMarkdown(combined) {
  const { summary, reports } = combined;

  let md = `# Complete Audit Report

Generated on ${combined.timestamp}

## Executive Summary

`;

  // UI Summary
  if (summary.ui) {
    md += `### UI Audit Results
- **Pages Crawled**: ${summary.ui.totalPages}
- **Successful**: ${summary.ui.successfulPages} (${((summary.ui.successfulPages / summary.ui.totalPages) * 100).toFixed(1)}%)
- **Failed**: ${summary.ui.failedPages}
- **Console Errors**: ${summary.ui.consoleErrors}
- **Network Errors**: ${summary.ui.networkErrors}
- **Safe Mode Blocks**: ${summary.ui.blockedRequests}

`;
  }

  // Static Analysis Summary
  if (summary.static) {
    md += `### Static Analysis Results
- **Routes Defined**: ${summary.static.routes}
- **Hardcoded Links**: ${summary.static.links}
- **Unvisited Routes**: ${summary.static.unvisitedRoutes}
- **Missing Routes**: ${summary.static.missingRoutes}

`;
  }

  // Backend Summary
  if (summary.backend) {
    md += `### Backend Audit Results
- **Total Issues**: ${summary.backend.totalIssues}
- **High Severity**: ${summary.backend.highSeverity}
- **Medium Severity**: ${summary.backend.mediumSeverity}
- **Low Severity**: ${summary.backend.lowSeverity}
- **Recommendations**: ${summary.backend.recommendations}

`;
  }

  // Overall Health Score
  const healthScore = calculateHealthScore(summary);
  md += `### Overall Health Score: ${healthScore.score}/100

${healthScore.description}

---

## Detailed Results

`;

  // UI Details
  if (reports.ui) {
    md += `## UI Audit Details

### Failed Pages (${reports.ui.summary.failedPages})

${reports.ui.results.filter(r => r.status === 'error').map(result => `
#### ${result.url}

- **Error**: ${result.errorMessage || 'Unknown error'}
- **Type**: ${result.errorType || 'unknown'}
${result.screenshotPath ? `- **Screenshot**: \`${path.relative(process.cwd(), result.screenshotPath)}\`` : ''}
${result.tracePath ? `- **Trace**: \`${path.relative(process.cwd(), result.tracePath)}\`` : ''}
`).join('\n')}

### Safe Mode Activity

${reports.ui.safeModeBlocked.length > 0 ?
  `Blocked ${reports.ui.safeModeBlocked.length} potentially destructive requests:\n\n` +
  reports.ui.safeModeBlocked.map(req => `- \`${req}\``).join('\n') :
  'No destructive requests were blocked - safe mode is working correctly.'
}

`;
  }

  // Static Analysis Details
  if (reports.static) {
    md += `## Static Analysis Details

### Routes Defined but Never Visited (${reports.static.comparison.routesDefinedButNeverVisited.length})

${reports.static.comparison.routesDefinedButNeverVisited.length > 0 ?
  reports.static.comparison.routesDefinedButNeverVisited.map(route => `- \`${route}\``).join('\n') :
  'All defined routes were visited during the crawl! 🎉'
}

### Links Referenced but Routes Missing (${reports.static.comparison.linksReferencedButMissingRoutes.length})

${reports.static.comparison.linksReferencedButMissingRoutes.length > 0 ?
  reports.static.comparison.linksReferencedButMissingRoutes.map(link => `- \`${link}\``).join('\n') :
  'All referenced links have corresponding routes! 🎉'
}

### Top Hardcoded Links

${reports.static.staticLinks.uniqueLinks.slice(0, 20).map(link => `- \`${link}\``).join('\n')}

${reports.static.staticLinks.uniqueLinks.length > 20 ? `\n... and ${reports.static.staticLinks.uniqueLinks.length - 20} more links` : ''}

`;
  }

  // Backend Details
  if (reports.backend) {
    md += `## Backend Audit Details

### Critical Issues (High Severity - ${reports.backend.summary.highSeverity})

${reports.backend.issues.filter(i => i.severity === 'high').map(issue => `
#### ${issue.table}: ${issue.issue}

**Description**: ${issue.description}

**Recommendation**: ${issue.recommendation || 'See backend report for details'}

${issue.details ? `**Details**: ${issue.details}` : ''}
`).join('\n')}

### Performance & Security Issues (Medium Severity - ${reports.backend.summary.mediumSeverity})

${reports.backend.issues.filter(i => i.severity === 'medium').map(issue => `
#### ${issue.table}: ${issue.issue}

**Description**: ${issue.description}

**Recommendation**: ${issue.recommendation || 'See backend report for details'}

${issue.details ? `**Details**: ${issue.details}` : ''}
`).join('\n')}

### Minor Issues (Low Severity - ${reports.backend.summary.lowSeverity})

${reports.backend.issues.filter(i => i.severity === 'low').map(issue => `
#### ${issue.table}: ${issue.issue}

**Description**: ${issue.description}

**Recommendation**: ${issue.recommendation || 'See backend report for details'}

${issue.details ? `**Details**: ${issue.details}` : ''}
`).join('\n')}

### All Recommendations

${reports.backend.recommendations.map(rec => `
#### ${rec.table}: ${rec.type}

**Description**: ${rec.description}

${rec.recommendation ? `**Recommendation**: ${rec.recommendation}` : ''}

${rec.details ? `**Details**: ${rec.details}` : ''}
`).join('\n')}

`;
  }

  md += `---

## Action Items

${generateActionItems(summary)}

---

*Combined audit report generated automatically*
`;

  return md;
}

function calculateHealthScore(summary) {
  let score = 100;
  let deductions = [];

  // UI Health (40% weight)
  if (summary.ui) {
    const uiScore = (summary.ui.successfulPages / summary.ui.totalPages) * 40;
    score -= (40 - uiScore);
    if (summary.ui.failedPages > 0) {
      deductions.push(`${summary.ui.failedPages} failed pages`);
    }
    if (summary.ui.consoleErrors > 0) {
      deductions.push(`${summary.ui.consoleErrors} console errors`);
    }
    if (summary.ui.networkErrors > 0) {
      deductions.push(`${summary.ui.networkErrors} network errors`);
    }
  }

  // Static Analysis Health (30% weight)
  if (summary.static) {
    const staticScore = Math.max(0, 30 - (summary.static.unvisitedRoutes + summary.static.missingRoutes) * 5);
    score -= (30 - staticScore);
    if (summary.static.unvisitedRoutes > 0) {
      deductions.push(`${summary.static.unvisitedRoutes} unvisited routes`);
    }
    if (summary.static.missingRoutes > 0) {
      deductions.push(`${summary.static.missingRoutes} missing routes`);
    }
  }

  // Backend Health (30% weight)
  if (summary.backend) {
    const backendScore = Math.max(0, 30 - (summary.backend.highSeverity * 10 + summary.backend.mediumSeverity * 5 + summary.backend.lowSeverity * 2));
    score -= (30 - backendScore);
    if (summary.backend.highSeverity > 0) {
      deductions.push(`${summary.backend.highSeverity} high-severity issues`);
    }
    if (summary.backend.mediumSeverity > 0) {
      deductions.push(`${summary.backend.mediumSeverity} medium-severity issues`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let description = '';
  if (score >= 90) {
    description = '🏆 Excellent! Your application is in great shape.';
  } else if (score >= 80) {
    description = '✅ Good! Minor issues to address.';
  } else if (score >= 70) {
    description = '⚠️ Fair. Several issues need attention.';
  } else if (score >= 60) {
    description = '🟡 Poor. Significant issues to fix.';
  } else {
    description = '🔴 Critical. Immediate attention required.';
  }

  if (deductions.length > 0) {
    description += ` Issues: ${deductions.join(', ')}.`;
  }

  return { score, description };
}

function generateActionItems(summary) {
  const actions = [];

  if (summary.ui && summary.ui.failedPages > 0) {
    actions.push(`🔴 **CRITICAL**: Fix ${summary.ui.failedPages} broken pages/links`);
  }

  if (summary.backend && summary.backend.highSeverity > 0) {
    actions.push(`🔴 **CRITICAL**: Address ${summary.backend.highSeverity} high-severity backend issues`);
  }

  if (summary.static && summary.static.missingRoutes > 0) {
    actions.push(`🟠 **HIGH**: Create ${summary.static.missingRoutes} missing routes referenced in code`);
  }

  if (summary.ui && summary.ui.consoleErrors > 0) {
    actions.push(`🟡 **MEDIUM**: Fix ${summary.ui.consoleErrors} console errors`);
  }

  if (summary.backend && summary.backend.mediumSeverity > 0) {
    actions.push(`🟡 **MEDIUM**: Address ${summary.backend.mediumSeverity} medium-severity backend issues`);
  }

  if (summary.static && summary.static.unvisitedRoutes > 0) {
    actions.push(`🟢 **LOW**: Consider why ${summary.static.unvisitedRoutes} routes were never visited during crawl`);
  }

  if (summary.ui && summary.ui.networkErrors > 0) {
    actions.push(`🟢 **LOW**: Investigate ${summary.ui.networkErrors} network errors`);
  }

  if (actions.length === 0) {
    return '🎉 **All Clear!** No critical issues found. Consider this a healthy codebase.';
  }

  return actions.map(action => `- ${action}`).join('\n');
}

// Main execution
function main() {
  console.log('📊 Compiling combined audit report...');

  const combined = combineReports();

    // Write combined JSON report
  fs.writeFileSync(
    path.join(process.cwd(), 'audit', 'report.json'),
    JSON.stringify(combined, null, 2)
  );

  // Generate combined markdown report
  const markdownReport = generateCombinedMarkdown(combined);
  fs.writeFileSync(
    path.join(process.cwd(), 'audit', 'report.md'),
    markdownReport
  );

  console.log('✅ Combined audit report generated!');
  console.log(`   📄 UI Report: ${combined.summary.ui ? 'Available' : 'Missing'}`);
  console.log(`   📋 Static Report: ${combined.summary.static ? 'Available' : 'Missing'}`);
  console.log(`   🗄️  Backend Report: ${combined.summary.backend ? 'Available' : 'Missing'}`);

  if (combined.summary.ui || combined.summary.static || combined.summary.backend) {
    const healthScore = calculateHealthScore(combined.summary);
    console.log(`   📊 Health Score: ${healthScore.score}/100`);
    console.log(`   💡 ${healthScore.description}`);
  }

  return combined;
}

if (require.main === module) {
  main();
}

module.exports = { main, combineReports, calculateHealthScore };

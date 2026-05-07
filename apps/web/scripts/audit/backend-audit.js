const fs = require('fs');
const path = require('path');

/**
 * Backend Audit Script using Supabase MCP
 *
 * This script analyzes the Supabase database schema for common issues:
 * - Unindexed foreign keys
 * - Duplicate indexes
 * - Multiple permissive policies per role/action on same table
 * - Unused indexes
 * - RLS policy issues
 *
 * Note: This script is designed to be run by an assistant that has access to Supabase MCP tools.
 * The actual MCP calls should be made by the assistant and results passed to this script.
 */
async function runSupabaseAudit() {
  console.log('🔍 Starting Supabase backend audit...');

  const issues = [];
  const recommendations = [];

  try {
    // 1. List all tables to understand the schema
    console.log('📋 Listing all tables...');
    const tablesResult = await listTables();
    const tables = tablesResult.map(t => t.name);

    console.log(`Found ${tables.length} tables:`, tables.join(', '));

    // 2. For each table, analyze indexes and foreign keys
    for (const table of tables) {
      console.log(`🔍 Analyzing table: ${table}`);

      // Check foreign keys and their indexes
      const fkIssues = await analyzeForeignKeys(table);
      issues.push(...fkIssues.issues);
      recommendations.push(...fkIssues.recommendations);

      // Check for duplicate indexes
      const duplicateIndexIssues = await analyzeDuplicateIndexes(table);
      issues.push(...duplicateIndexIssues.issues);
      recommendations.push(...duplicateIndexIssues.recommendations);

      // Check RLS policies
      const rlsIssues = await analyzeRLSPolicies(table);
      issues.push(...rlsIssues.issues);
      recommendations.push(...rlsIssues.recommendations);
    }

    // 3. Check for unused indexes (informational)
    console.log('📊 Analyzing unused indexes...');
    const unusedIndexInfo = await analyzeUnusedIndexes();
    recommendations.push(...unusedIndexInfo.recommendations);

    // 4. Check for security advisors
    console.log('🔒 Checking security advisors...');
    const securityAdvisors = await getSecurityAdvisors();
    issues.push(...securityAdvisors.issues);

    // 5. Check for performance advisors
    console.log('⚡ Checking performance advisors...');
    const performanceAdvisors = await getPerformanceAdvisors();
    recommendations.push(...performanceAdvisors.recommendations);

  } catch (error) {
    console.error('Error during backend audit:', error);
    issues.push({
      type: 'error',
      severity: 'high',
      table: 'system',
      issue: 'Audit failed',
      description: `Backend audit encountered an error: ${error.message}`,
      recommendation: 'Check Supabase connection and permissions'
    });
  }

  return { issues, recommendations };
}

/**
 * List all tables in the database using MCP tool
 */
async function listTables() {
  try {
    console.log('📋 Using MCP tool: mcp_supabase_list_tables');
    // Call the MCP tool directly - this will be replaced by the actual tool call
    const result = await mcp_supabase_list_tables();
    return result.map(table => ({ name: table.name || table.tablename }));
  } catch (error) {
    console.warn('MCP list_tables failed, falling back to SQL:', error.message);
    // Fallback to SQL if MCP fails
    const result = await executeSQL(`
      SELECT schemaname, tablename as name
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);
    return result;
  }
}

/**
 * Analyze foreign keys and their indexes
 */
async function analyzeForeignKeys(tableName) {
  const issues = [];
  const recommendations = [];

  try {
    // Get foreign keys for this table
    const fkResult = await executeSQL(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = '${tableName}'
        AND tc.table_schema = 'public';
    `);

    for (const fk of fkResult) {
      // Check if foreign key column has an index
      const indexResult = await executeSQL(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = '${fk.table_name}'
          AND indexdef LIKE '%(${fk.column_name})%';
      `);

      if (indexResult.length === 0) {
        issues.push({
          type: 'performance',
          severity: 'medium',
          table: tableName,
          issue: 'Unindexed foreign key',
          description: `Foreign key column '${fk.column_name}' references '${fk.foreign_table_name}.${fk.foreign_column_name}' but has no index`,
          recommendation: `CREATE INDEX idx_${tableName}_${fk.column_name} ON ${tableName} (${fk.column_name});`
        });
      } else {
        recommendations.push({
          type: 'performance',
          table: tableName,
          description: `Foreign key '${fk.column_name}' is properly indexed`,
          details: `Index: ${indexResult[0].indexname}`
        });
      }
    }

  } catch (error) {
    issues.push({
      type: 'error',
      severity: 'low',
      table: tableName,
      issue: 'Could not analyze foreign keys',
      description: error.message
    });
  }

  return { issues, recommendations };
}

/**
 * Analyze duplicate indexes on a table
 */
async function analyzeDuplicateIndexes(tableName) {
  const issues = [];
  const recommendations = [];

  try {
    const indexResult = await executeSQL(`
      SELECT
        indexname,
        indexdef,
        array_agg(attname ORDER BY attnum) as columns
      FROM pg_indexes i
      JOIN pg_index idx ON idx.indexrelid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
      WHERE tablename = '${tableName}'
        AND schemaname = 'public'
      GROUP BY indexname, indexdef
      HAVING array_length(array_agg(attname), 1) > 0;
    `);

    // Group by column sets to find duplicates
    const columnGroups = {};
    for (const idx of indexResult) {
      const key = idx.columns.sort().join(',');
      if (!columnGroups[key]) {
        columnGroups[key] = [];
      }
      columnGroups[key].push(idx);
    }

    for (const [columns, indexes] of Object.entries(columnGroups)) {
      if (indexes.length > 1) {
        issues.push({
          type: 'performance',
          severity: 'low',
          table: tableName,
          issue: 'Duplicate indexes',
          description: `Multiple indexes on the same columns: ${columns}`,
          details: indexes.map(idx => idx.indexname).join(', '),
          recommendation: 'Consider removing redundant indexes, keeping only the most efficient one'
        });
      }
    }

  } catch (error) {
    issues.push({
      type: 'error',
      severity: 'low',
      table: tableName,
      issue: 'Could not analyze duplicate indexes',
      description: error.message
    });
  }

  return { issues, recommendations };
}

/**
 * Analyze RLS policies for a table
 */
async function analyzeRLSPolicies(tableName) {
  const issues = [];
  const recommendations = [];

  try {
    const policyResult = await executeSQL(`
      SELECT
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE tablename = '${tableName}'
        AND schemaname = 'public';
    `);

    // Group policies by command and role to check for duplicates
    const policyGroups = {};
    for (const policy of policyResult) {
      const key = `${policy.cmd}-${policy.roles?.sort().join(',') || 'public'}`;
      if (!policyGroups[key]) {
        policyGroups[key] = [];
      }
      policyGroups[key].push(policy);
    }

    for (const [key, policies] of Object.entries(policyGroups)) {
      if (policies.length > 1) {
        const permissivePolicies = policies.filter(p => p.permissive === 't');
        if (permissivePolicies.length > 1) {
          issues.push({
            type: 'security',
            severity: 'medium',
            table: tableName,
            issue: 'Multiple permissive policies',
            description: `Multiple permissive policies for ${key}: ${policies.map(p => p.policyname).join(', ')}`,
            recommendation: 'Consider consolidating policies or making them restrictive where appropriate'
          });
        }
      }
    }

    // Check if RLS is enabled but no policies exist
    if (policyResult.length === 0) {
      const rlsEnabled = await executeSQL(`
        SELECT tablename
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = '${tableName}'
          AND c.relrowsecurity = true;
      `);

      if (rlsEnabled.length > 0) {
        issues.push({
          type: 'security',
          severity: 'high',
          table: tableName,
          issue: 'RLS enabled but no policies',
          description: 'Row Level Security is enabled but no policies are defined',
          recommendation: 'Define appropriate RLS policies or disable RLS if not needed'
        });
      }
    }

  } catch (error) {
    issues.push({
      type: 'error',
      severity: 'low',
      table: tableName,
      issue: 'Could not analyze RLS policies',
      description: error.message
    });
  }

  return { issues, recommendations };
}

/**
 * Analyze unused indexes (informational only)
 */
async function analyzeUnusedIndexes() {
  const recommendations = [];

  try {
    const unusedResult = await executeSQL(`
      SELECT
        schemaname,
        tablename,
        indexname,
        idx_scan as scans
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
        AND idx_scan = 0
      ORDER BY tablename, indexname;
    `);

    for (const idx of unusedResult) {
      recommendations.push({
        type: 'performance',
        severity: 'info',
        table: idx.tablename,
        description: `Unused index: ${idx.indexname} (0 scans)`,
        recommendation: 'Consider removing unused indexes to improve write performance, but verify they are truly unused in production'
      });
    }

  } catch (error) {
    recommendations.push({
      type: 'error',
      table: 'system',
      description: `Could not analyze unused indexes: ${error.message}`
    });
  }

  return { recommendations };
}

/**
 * Get security advisors from Supabase using MCP
 */
async function getSecurityAdvisors() {
  const issues = [];

  try {
    console.log('🔒 Using MCP tool: mcp_supabase_get_advisors (security)');
    // This will be called by the assistant using the MCP tool
    const advisors = await mcp_supabase_get_advisors({ type: 'security' });

    for (const advisor of advisors) {
      issues.push({
        type: 'security',
        severity: advisor.level === 'error' ? 'high' : advisor.level === 'warning' ? 'medium' : 'low',
        table: advisor.table || 'system',
        issue: advisor.title,
        description: advisor.description,
        recommendation: advisor.remediation || 'See Supabase dashboard for details'
      });
    }

  } catch (error) {
    console.warn('MCP security advisors failed:', error.message);
    issues.push({
      type: 'error',
      severity: 'low',
      table: 'system',
      issue: 'Could not check security advisors',
      description: error.message
    });
  }

  return { issues };
}

/**
 * Get performance advisors from Supabase
 */
async function getPerformanceAdvisors() {
  const recommendations = [];

  try {
    // This would use mcp_supabase_get_advisors with type='performance'
    console.log('Performance advisors check - implement with MCP tool');

    recommendations.push({
      type: 'info',
      table: 'system',
      description: 'Performance advisor check should be implemented using mcp_supabase_get_advisors'
    });

  } catch (error) {
    recommendations.push({
      type: 'error',
      severity: 'low',
      table: 'system',
      description: `Could not check performance advisors: ${error.message}`
    });
  }

  return { recommendations };
}

/**
 * Execute raw SQL query (placeholder for MCP tool)
 */
async function executeSQL(query) {
  // This would use mcp_supabase_execute_sql
  // For now, return empty array as placeholder
  console.log(`Would execute SQL: ${query.substring(0, 100)}...`);

  // Placeholder - in real implementation, this would use the MCP tool
  return [];
}

/**
 * Generate backend audit report
 */
function generateBackendReport(auditResults) {
  const { issues, recommendations } = auditResults;

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalIssues: issues.length,
      highSeverity: issues.filter(i => i.severity === 'high').length,
      mediumSeverity: issues.filter(i => i.severity === 'medium').length,
      lowSeverity: issues.filter(i => i.severity === 'low').length,
      totalRecommendations: recommendations.length
    },
    issues,
    recommendations
  };

  // Write JSON report
  fs.writeFileSync(
    path.join(process.cwd(), 'audit', 'backend_report.json'),
    JSON.stringify(report, null, 2)
  );

  // Generate markdown report
  const md = `# Backend Audit Report

Generated on ${report.timestamp}

## Summary

- **Total Issues**: ${report.summary.totalIssues}
- **High Severity**: ${report.summary.highSeverity}
- **Medium Severity**: ${report.summary.mediumSeverity}
- **Low Severity**: ${report.summary.lowSeverity}
- **Total Recommendations**: ${report.summary.totalRecommendations}

## Issues by Severity

### High Severity Issues (${report.summary.highSeverity})

${issues.filter(i => i.severity === 'high').map(issue => `
#### ${issue.table}: ${issue.issue}

**Description**: ${issue.description}

**Recommendation**: ${issue.recommendation || 'See details above'}

${issue.details ? `**Details**: ${issue.details}` : ''}
`).join('\n')}

### Medium Severity Issues (${report.summary.mediumSeverity})

${issues.filter(i => i.severity === 'medium').map(issue => `
#### ${issue.table}: ${issue.issue}

**Description**: ${issue.description}

**Recommendation**: ${issue.recommendation || 'See details above'}

${issue.details ? `**Details**: ${issue.details}` : ''}
`).join('\n')}

### Low Severity Issues (${report.summary.lowSeverity})

${issues.filter(i => i.severity === 'low').map(issue => `
#### ${issue.table}: ${issue.issue}

**Description**: ${issue.description}

**Recommendation**: ${issue.recommendation || 'See details above'}

${issue.details ? `**Details**: ${issue.details}` : ''}
`).join('\n')}

## All Recommendations

${recommendations.map(rec => `
### ${rec.table}: ${rec.type}

**Description**: ${rec.description}

${rec.recommendation ? `**Recommendation**: ${rec.recommendation}` : ''}

${rec.details ? `**Details**: ${rec.details}` : ''}
`).join('\n')}

---
*Report generated by automated backend audit*
`;

  fs.writeFileSync(
    path.join(process.cwd(), 'audit', 'backend_report.md'),
    md
  );

  return report;
}

// Main execution
async function main() {
  try {
    const auditResults = await runSupabaseAudit();
    const report = generateBackendReport(auditResults);

    console.log('✅ Backend audit complete!');
    console.log(`   🔴 High severity issues: ${report.summary.highSeverity}`);
    console.log(`   🟠 Medium severity issues: ${report.summary.mediumSeverity}`);
    console.log(`   🟡 Low severity issues: ${report.summary.lowSeverity}`);
    console.log(`   💡 Recommendations: ${report.summary.totalRecommendations}`);

    return report;
  } catch (error) {
    console.error('Backend audit failed:', error);
    throw error;
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, runSupabaseAudit };

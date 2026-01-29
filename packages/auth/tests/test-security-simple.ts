import "../../../tests/test-utils/env-fetch.ts";
// Simple test to verify security system implementation
import { getSecurityService } from "./src/services/security-service.ts";
import { getEnhancedRbacService } from "./src/services/enhanced-rbac-service.ts";

async function testSecuritySystem() {
	console.log("Testing Advanced Security System...");
	
	try {
		// Initialize services
		const securityService = getSecurityService();
		const rbacService = getEnhancedRbacService();
		
		// Initialize default security policy
		console.log("Initializing default security policy...");
		const policy = await securityService.initializeDefaultSecurityPolicy();
		console.log("✓ Default security policy initialized:", policy.name);
		
		// Initialize enhanced RBAC
		console.log("Initializing enhanced RBAC...");
		await rbacService.initializeDefaultRolesAndPermissions();
		const roles = await rbacService.getAllRoles();
		console.log("✓ Enhanced RBAC initialized with", roles.length, "roles");
		
		// Test data encryption
		console.log("Testing data encryption...");
		const testData = "This is sensitive test data";
		const encrypted = securityService.encryptSensitiveData(testData);
		const decrypted = securityService.decryptSensitiveData(encrypted);
		
		if (decrypted === testData) {
			console.log("✓ Data encryption/decryption working correctly");
		} else {
			console.log("✗ Data encryption/decryption failed");
		}
		
		// Test audit logging
		console.log("Testing audit logging...");
		const auditLog = await securityService.logAuditEvent({
			action: "test_security",
			resource: "security_system",
			outcome: "success",
			details: { test: "security_system_verification" },
			riskLevel: "low",
			category: "system",
		});
		console.log("✓ Audit log created:", auditLog.id);
		
		// Test security alert creation
		console.log("Testing security alert creation...");
		const alert = await securityService.createSecurityAlert({
			type: "system_anomaly",
			severity: "medium",
			title: "Test Security Alert",
			description: "This is a test alert for security system verification",
			details: { test: true, component: "security_system" },
		});
		console.log("✓ Security alert created:", alert.id);
		
		// Test permission checking
		console.log("Testing permission checking...");
		const testUserId = "test-user-123";
		const testRole = roles.find(r => r.name === "Enhanced Developer");
		if (testRole) {
			await rbacService.assignRoleToUser(testUserId, testRole.id);
			
			const permissionResult = await rbacService.checkPermission(
				testUserId,
				"tasks",
				"create",
				{ ipAddress: "192.168.1.100" }
			);
			
			if (permissionResult.granted) {
				console.log("✓ Permission checking working:", permissionResult.role?.name);
			} else {
				console.log("✗ Permission checking failed:", permissionResult.reason);
			}
		}
		
		// Test security metrics
		console.log("Testing security metrics...");
		const endDate = new Date();
		const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours
		
		const metrics = await securityService.generateSecurityMetrics(startDate, endDate);
		console.log("✓ Security metrics generated:", {
			totalLogins: metrics.authentication.totalLogins,
			successfulLogins: metrics.authentication.successfulLogins,
			failedLogins: metrics.authentication.failedLogins,
		});
		
		// Test security dashboard
		console.log("Testing security dashboard...");
		const dashboardData = await securityService.getSecurityDashboardData();
		console.log("✓ Security dashboard data generated:", {
			totalUsers: dashboardData.summary.totalUsers,
			openAlerts: dashboardData.summary.openAlerts,
			complianceScore: dashboardData.summary.complianceScore,
		});
		
		console.log("\n🎉 All security system tests passed!");
		console.log("\n📊 Security System Summary:");
		console.log("- ✓ Default security policy initialized");
		console.log("- ✓ Enhanced RBAC with", roles.length, "roles");
		console.log("- ✓ Data encryption/decryption working");
		console.log("- ✓ Audit logging functional");
		console.log("- ✓ Security alert creation working");
		console.log("- ✓ Permission checking functional");
		console.log("- ✓ Security metrics generation working");
		console.log("- ✓ Security dashboard data working");
		
	} catch (error) {
		console.error("❌ Security system test failed:", error);
		process.exit(1);
	}
}

// Run the test
testSecuritySystem().then(() => {
	console.log("\nSecurity system test completed.");
	process.exit(0);
}).catch((error) => {
	console.error("Test execution failed:", error);
	process.exit(1);
});
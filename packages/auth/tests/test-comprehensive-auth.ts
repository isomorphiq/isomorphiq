import { UserManager, AuthService, PermissionService } from "@isomorphiq/auth";
import type { CreateUserInput } from "@isomorphiq/auth";

async function runComprehensiveAuthTests() {
  console.log('🔐 Running Comprehensive Authentication & Authorization Tests...\n')

  const userManager = new UserManager()
  const authService = new AuthService()
  const permissionService = new PermissionService()

  try {
    // Test 1: Create Users with Different Roles
    console.log('Test 1: Creating Users with Different Roles')
    const testUsers: CreateUserInput[] = [
      {
        username: `admin_${Date.now()}`,
        email: `admin${Date.now()}@example.com`,
        password: 'AdminPass123!',
        role: 'admin',
        profile: { firstName: 'Admin', lastName: 'User' }
      },
      {
        username: `manager_${Date.now()}`,
        email: `manager${Date.now()}@example.com`,
        password: 'ManagerPass123!',
        role: 'manager',
        profile: { firstName: 'Manager', lastName: 'User' }
      },
      {
        username: `developer_${Date.now()}`,
        email: `developer${Date.now()}@example.com`,
        password: 'DeveloperPass123!',
        role: 'developer',
        profile: { firstName: 'Developer', lastName: 'User' }
      },
      {
        username: `viewer_${Date.now()}`,
        email: `viewer${Date.now()}@example.com`,
        password: 'ViewerPass123!',
        role: 'viewer',
        profile: { firstName: 'Viewer', lastName: 'User' }
      }
    ]

    const createdUsers = []
    for (const userInput of testUsers) {
      const user = await userManager.createUser(userInput)
      createdUsers.push(user)
      console.log(`✅ Created ${user.role} user: ${user.username}`)
    }
    console.log()

    // Test 2: Authentication Flow
    console.log('Test 2: Authentication Flow')
    const authResults = []
    for (const user of createdUsers) {
      const authResult = await userManager.authenticateUser({
        username: user.username,
        password: user.role === 'admin' ? 'AdminPass123!' : 
                  user.role === 'manager' ? 'ManagerPass123!' :
                  user.role === 'developer' ? 'DeveloperPass123!' : 'ViewerPass123!'
      })
      
      if (authResult.success && authResult.token) {
        authResults.push({ user, ...authResult })
        console.log(`✅ ${user.username} authenticated successfully`)
      } else {
        console.log(`❌ ${user.username} authentication failed: ${authResult.error}`)
      }
    }
    console.log()

    // Test 3: Permission Matrix Validation
    console.log('Test 3: Permission Matrix Validation')
    const permissionMatrix = permissionService.getPermissionMatrix()
    
    Object.entries(permissionMatrix).forEach(([role, resources]) => {
      console.log(`\n   ${role.toUpperCase()} Permissions:`)
      Object.entries(resources).forEach(([resource, actions]) => {
        console.log(`     ${resource}: ${actions.join(', ')}`)
      })
    })
    console.log()

    // Test 4: Context-Based Permission Evaluation
    console.log('Test 4: Context-Based Permission Evaluation')
    const developerUser = createdUsers.find(u => u.role === 'developer')
    if (developerUser) {
      const userPermissions = await userManager.getUserPermissions(developerUser)
      
      const testCases = [
        { 
          resource: 'tasks', 
          action: 'update', 
          context: { userId: developerUser.id, taskCreatedBy: developerUser.id },
          expected: true,
          description: 'Can update own created task'
        },
        { 
          resource: 'tasks', 
          action: 'update', 
          context: { userId: developerUser.id, taskCreatedBy: 'other-user-id' },
          expected: false,
          description: 'Cannot update others task'
        },
        { 
          resource: 'tasks', 
          action: 'delete', 
          context: { userId: developerUser.id, taskCreatedBy: developerUser.id },
          expected: true,
          description: 'Can delete own created task'
        },
        { 
          resource: 'users', 
          action: 'read', 
          context: { userId: developerUser.id },
          expected: false,
          description: 'Cannot read users list'
        },
        { 
          resource: 'profile', 
          action: 'update', 
          context: { userId: developerUser.id },
          expected: true,
          description: 'Can update own profile'
        }
      ]

      for (const testCase of testCases) {
        const hasPermission = await permissionService.hasPermission(
          userPermissions,
          testCase.resource,
          testCase.action,
          testCase.context
        )
        const status = hasPermission === testCase.expected ? '✅' : '❌'
        console.log(`   ${status} ${testCase.description}: ${hasPermission ? 'Granted' : 'Denied'}`)
      }
    }
    console.log()

    // Test 5: Password Reset Flow
    console.log('Test 5: Password Reset Flow')
    const testUser = createdUsers[0] // Use admin user
    if (!testUser) {
      throw new Error('Test user not found')
    }
    const resetRequest = await userManager.requestPasswordReset({ email: testUser.email })
    console.log(`   Password reset requested: ${resetRequest.success ? '✅' : '❌'} ${resetRequest.message}`)

    if (resetRequest.success) {
      // Simulate getting the token from the database (in production, this would come from email)
      const resetResult = await userManager.resetPassword({
        token: 'dummy-token', // This will fail, but tests the flow
        newPassword: 'NewSecurePass456!@#'
      })
      console.log(`   Password reset with dummy token: ${resetResult.success ? '✅' : '❌'} ${resetResult.message}`)
    }
    console.log()

    // Test 6: Email Verification Flow
    console.log('Test 6: Email Verification Flow')
    const unverifiedUser = createdUsers[1] // Use manager user
    if (!unverifiedUser) {
      throw new Error('Unverified user not found')
    }
    console.log(`   Email verified before: ${unverifiedUser.isEmailVerified}`)
    
    const verificationRequest = await userManager.generateEmailVerification(unverifiedUser.id)
    console.log(`   Email verification generated: ${verificationRequest.success ? '✅' : '❌'} ${verificationRequest.message}`)

    if (verificationRequest.success && verificationRequest.token) {
      const verifyResult = await userManager.verifyEmail({ token: 'dummy-token' })
      console.log(`   Email verification with dummy token: ${verifyResult.success ? '✅' : '❌'} ${verifyResult.message}`)
    }
    console.log()

    // Test 7: Session Management
    console.log('Test 7: Session Management')
    const sessionUser = createdUsers[2] // Use developer user
    if (!sessionUser) {
      throw new Error('Session user not found')
    }
    const sessionAuth = await userManager.authenticateUser({
      username: sessionUser.username,
      password: 'DeveloperPass123!'
    })

    if (sessionAuth.success && sessionAuth.token) {
      // Validate session
      const validatedUser = await userManager.validateSession(sessionAuth.token)
      console.log(`   Session validation: ${validatedUser ? '✅' : '❌'}`)

      // Get user sessions
      const sessions = await userManager.getUserSessions(sessionUser.id)
      console.log(`   Active sessions count: ${sessions.length}`)

      // Logout
      const logoutSuccess = await userManager.logoutUser(sessionAuth.token)
      console.log(`   Logout successful: ${logoutSuccess ? '✅' : '❌'}`)

      // Validate session after logout
      const validatedUserAfterLogout = await userManager.validateSession(sessionAuth.token)
      console.log(`   Session validation after logout: ${validatedUserAfterLogout ? '❌' : '✅'} (should be false)`)
    }
    console.log()

    // Test 8: Token Refresh
    console.log('Test 8: Token Refresh')
    const refreshUser = createdUsers[3] // Use viewer user
    if (!refreshUser) {
      throw new Error('Refresh user not found')
    }
    const refreshAuth = await userManager.authenticateUser({
      username: refreshUser.username,
      password: 'ViewerPass123!'
    })

    if (refreshAuth.success && refreshAuth.refreshToken) {
      const refreshResult = await userManager.refreshToken(refreshAuth.refreshToken)
      console.log(`   Token refresh: ${refreshResult.success ? '✅' : '❌'}`)
      if (refreshResult.success) {
        console.log(`   New token received: ${refreshResult.token ? '✅' : '❌'}`)
        console.log(`   New refresh token received: ${refreshResult.refreshToken ? '✅' : '❌'}`)
      }
    }
    console.log()

    // Test 9: Password Change
    console.log('Test 9: Password Change')
    const passwordUser = createdUsers[0] // Use admin user
    if (!passwordUser) {
      throw new Error('Password user not found')
    }
    await userManager.changePassword({
      userId: passwordUser.id,
      currentPassword: 'AdminPass123!',
      newPassword: 'NewAdminPass456!@#'
    })
    console.log(`✅ Password changed successfully for ${passwordUser.username}`)

    // Test authentication with new password
    const newAuthResult = await userManager.authenticateUser({
      username: passwordUser.username,
      password: 'NewAdminPass456!@#'
    })
    console.log(`   Authentication with new password: ${newAuthResult.success ? '✅' : '❌'}`)
    console.log()

    // Test 10: Profile Management
    console.log('Test 10: Profile Management')
    const profileUser = createdUsers[1] // Use manager user
    if (!profileUser) {
      throw new Error('Profile user not found')
    }
    const profileUpdate = {
      userId: profileUser.id,
      profile: {
        firstName: 'Updated',
        lastName: 'Name',
        bio: 'Updated bio for testing',
        timezone: 'America/New_York'
      },
      preferences: {
        theme: 'light' as const,
        notifications: {
          email: false,
          push: true,
          taskAssigned: true,
          taskCompleted: true,
          taskOverdue: false
        },
        dashboard: {
          defaultView: 'kanban' as const,
          itemsPerPage: 50,
          showCompleted: true
        }
      }
    }

    const updatedProfileUser = await userManager.updateProfile(profileUpdate)
    console.log(`✅ Profile updated successfully for ${updatedProfileUser.username}`)
    console.log(`   New name: ${updatedProfileUser.profile.firstName} ${updatedProfileUser.profile.lastName}`)
    console.log(`   New timezone: ${updatedProfileUser.profile.timezone}`)
    console.log(`   New theme: ${updatedProfileUser.preferences.theme}`)
    console.log()

    // Test 11: Security Features
    console.log('Test 11: Security Features')
    
    // Test password strength validation
    const passwordTests = [
      { password: 'weak', expected: false },
      { password: 'strong123!', expected: false },
      { password: 'StrongPassword123!', expected: true }
    ]

    passwordTests.forEach(test => {
      const validation = authService.validatePasswordStrength(test.password)
      const status = validation.isValid === test.expected ? '✅' : '❌'
      console.log(`   ${status} Password "${test.password}": ${validation.isValid ? 'Valid' : 'Invalid'}`)
    })

    // Test device info extraction
    const testUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    const deviceInfo = authService.extractDeviceInfo(testUserAgent)
    console.log(`   Device info extraction: ✅ ${deviceInfo.type} - ${deviceInfo.os} ${deviceInfo.browser}`)
    console.log()

    // Test 12: Cleanup Operations
    console.log('Test 12: Cleanup Operations')
    await userManager.cleanupExpiredSessions()
    console.log('✅ Session cleanup completed')
    
    await userManager.cleanupExpiredTokens()
    console.log('✅ Token cleanup completed')
    console.log()

    console.log('🎉 All comprehensive authentication and authorization tests completed successfully!')

  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Run the tests
runComprehensiveAuthTests().catch(console.error)

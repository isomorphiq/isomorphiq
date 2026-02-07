import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";

export const IdentifiableTrait = trait({
    id: method<Self, string>(),
});

export const HasUserIdTrait = trait({
    userId: method<Self, string>(),
});

export const UserRoleSchema = z.enum(["admin", "manager", "developer", "viewer"]);
export type UserRole = z.output<typeof UserRoleSchema>;

export const UserProfileSchema = z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    avatar: z.string().optional(),
    bio: z.string().optional(),
    timezone: z.string().optional(),
    language: z.string().optional(),
});

export const UserProfileStruct = struct.name("UserProfile")<z.output<typeof UserProfileSchema>, z.input<typeof UserProfileSchema>>(UserProfileSchema);
export type UserProfile = StructSelf<typeof UserProfileStruct>;

export const UserPreferencesSchema = z.object({
    theme: z.enum(["light", "dark", "auto"]),
    notifications: z.object({
        email: z.boolean(),
        push: z.boolean(),
        taskAssigned: z.boolean(),
        taskCompleted: z.boolean(),
        taskOverdue: z.boolean(),
    }),
    dashboard: z.object({
        defaultView: z.enum(["list", "kanban", "calendar"]),
        itemsPerPage: z.number(),
        showCompleted: z.boolean(),
    }),
});

export const UserPreferencesStruct = struct.name("UserPreferences")<z.output<typeof UserPreferencesSchema>, z.input<typeof UserPreferencesSchema>>(UserPreferencesSchema);
export type UserPreferences = StructSelf<typeof UserPreferencesStruct>;

const DateLikeSchema = z.coerce.date();

export const UserSchema = z.object({
    id: z.string(),
    username: z.string(),
    email: z.string(),
    passwordHash: z.string(),
    role: UserRoleSchema,
    isActive: z.boolean(),
    isEmailVerified: z.boolean(),
    profile: UserProfileSchema,
    preferences: UserPreferencesSchema,
    createdAt: DateLikeSchema,
    updatedAt: DateLikeSchema,
    lastLoginAt: DateLikeSchema.optional(),
    passwordChangedAt: DateLikeSchema.optional(),
    failedLoginAttempts: z.number(),
    lockedUntil: DateLikeSchema.optional(),
});

export const UserStruct = struct.name("User")<z.output<typeof UserSchema>, z.input<typeof UserSchema>>(UserSchema);
export type User = StructSelf<typeof UserStruct>;

export const PublicUserSchema = UserSchema.omit({ passwordHash: true });
export const PublicUserStruct = struct.name("PublicUser")<z.output<typeof PublicUserSchema>, z.input<typeof PublicUserSchema>>(PublicUserSchema);
export type PublicUser = StructSelf<typeof PublicUserStruct>;

export const CreateUserInputSchema = z.object({
    username: z.string(),
    email: z.string(),
    password: z.string(),
    role: UserRoleSchema.optional(),
    profile: UserProfileSchema.partial().optional(),
    preferences: UserPreferencesSchema.partial().optional(),
});

export const CreateUserInputStruct = struct.name("CreateUserInput")<z.output<typeof CreateUserInputSchema>, z.input<typeof CreateUserInputSchema>>(CreateUserInputSchema);
export type CreateUserInput = StructSelf<typeof CreateUserInputStruct>;

export const UpdateUserInputSchema = z.object({
    id: z.string(),
    username: z.string().optional(),
    email: z.string().optional(),
    role: UserRoleSchema.optional(),
    isActive: z.boolean().optional(),
    profile: UserProfileSchema.partial().optional(),
    preferences: UserPreferencesSchema.partial().optional(),
});

export const UpdateUserInputStruct = struct.name("UpdateUserInput")<z.output<typeof UpdateUserInputSchema>, z.input<typeof UpdateUserInputSchema>>(UpdateUserInputSchema);
export type UpdateUserInput = StructSelf<typeof UpdateUserInputStruct>;

export const UpdateProfileInputSchema = z.object({
    userId: z.string(),
    profile: UserProfileSchema.partial().optional(),
    preferences: UserPreferencesSchema.partial().optional(),
});

export const UpdateProfileInputStruct = struct.name("UpdateProfileInput")<z.output<typeof UpdateProfileInputSchema>, z.input<typeof UpdateProfileInputSchema>>(UpdateProfileInputSchema);
export type UpdateProfileInput = StructSelf<typeof UpdateProfileInputStruct>;

export const ChangePasswordInputSchema = z.object({
    userId: z.string(),
    currentPassword: z.string(),
    newPassword: z.string(),
});

export const ChangePasswordInputStruct = struct.name("ChangePasswordInput")<z.output<typeof ChangePasswordInputSchema>, z.input<typeof ChangePasswordInputSchema>>(ChangePasswordInputSchema);
export type ChangePasswordInput = StructSelf<typeof ChangePasswordInputStruct>;

export const PasswordResetRequestSchema = z.object({
    email: z.string(),
});

export const PasswordResetRequestStruct = struct.name("PasswordResetRequest")<z.output<typeof PasswordResetRequestSchema>, z.input<typeof PasswordResetRequestSchema>>(PasswordResetRequestSchema);
export type PasswordResetRequest = StructSelf<typeof PasswordResetRequestStruct>;

export const PasswordResetInputSchema = z.object({
    token: z.string(),
    newPassword: z.string(),
});

export const PasswordResetInputStruct = struct.name("PasswordResetInput")<z.output<typeof PasswordResetInputSchema>, z.input<typeof PasswordResetInputSchema>>(PasswordResetInputSchema);
export type PasswordResetInput = StructSelf<typeof PasswordResetInputStruct>;

export const EmailVerificationInputSchema = z.object({
    token: z.string(),
});

export const EmailVerificationInputStruct = struct.name("EmailVerificationInput")<z.output<typeof EmailVerificationInputSchema>, z.input<typeof EmailVerificationInputSchema>>(EmailVerificationInputSchema);
export type EmailVerificationInput = StructSelf<typeof EmailVerificationInputStruct>;

export const PasswordResetTokenSchema = z.object({
    id: z.string(),
    userId: z.string(),
    token: z.string(),
    email: z.string(),
    expiresAt: DateLikeSchema,
    createdAt: DateLikeSchema,
    isUsed: z.boolean(),
});

export const PasswordResetTokenStruct = struct.name("PasswordResetToken")<z.output<typeof PasswordResetTokenSchema>, z.input<typeof PasswordResetTokenSchema>>(PasswordResetTokenSchema);
export type PasswordResetToken = StructSelf<typeof PasswordResetTokenStruct>;

export const EmailVerificationTokenSchema = z.object({
    id: z.string(),
    userId: z.string(),
    token: z.string(),
    email: z.string(),
    expiresAt: DateLikeSchema,
    createdAt: DateLikeSchema,
    isUsed: z.boolean(),
});

export const EmailVerificationTokenStruct = struct.name("EmailVerificationToken")<z.output<typeof EmailVerificationTokenSchema>, z.input<typeof EmailVerificationTokenSchema>>(EmailVerificationTokenSchema);
export type EmailVerificationToken = StructSelf<typeof EmailVerificationTokenStruct>;

export const AuthCredentialsSchema = z.object({
    username: z.string(),
    password: z.string(),
});

export const AuthCredentialsStruct = struct.name("AuthCredentials")<z.output<typeof AuthCredentialsSchema>, z.input<typeof AuthCredentialsSchema>>(AuthCredentialsSchema);
export type AuthCredentials = StructSelf<typeof AuthCredentialsStruct>;

export const AuthResultSchema = z.object({
    success: z.boolean(),
    user: PublicUserSchema.optional(),
    token: z.string().optional(),
    refreshToken: z.string().optional(),
    expiresIn: z.number().optional(),
    error: z.string().optional(),
});

export const AuthResultStruct = struct.name("AuthResult")<z.output<typeof AuthResultSchema>, z.input<typeof AuthResultSchema>>(AuthResultSchema);
export type AuthResult = StructSelf<typeof AuthResultStruct>;

export const RefreshTokenResultSchema = z.object({
    success: z.boolean(),
    token: z.string().optional(),
    refreshToken: z.string().optional(),
    expiresIn: z.number().optional(),
    error: z.string().optional(),
});

export const RefreshTokenResultStruct = struct.name("RefreshTokenResult")<z.output<typeof RefreshTokenResultSchema>, z.input<typeof RefreshTokenResultSchema>>(RefreshTokenResultSchema);
export type RefreshTokenResult = StructSelf<typeof RefreshTokenResultStruct>;

export const DeviceInfoSchema = z.object({
    type: z.enum(["desktop", "mobile", "tablet", "unknown"]),
    os: z.string().optional(),
    browser: z.string().optional(),
    name: z.string().optional(),
});

export const DeviceInfoStruct = struct.name("DeviceInfo")<z.output<typeof DeviceInfoSchema>, z.input<typeof DeviceInfoSchema>>(DeviceInfoSchema);
export type DeviceInfo = StructSelf<typeof DeviceInfoStruct>;

export const SessionSchema = z.object({
    id: z.string(),
    userId: z.string(),
    token: z.string(),
    refreshToken: z.string(),
    deviceInfo: DeviceInfoSchema.optional(),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    createdAt: DateLikeSchema,
    expiresAt: DateLikeSchema,
    refreshExpiresAt: DateLikeSchema,
    isActive: z.boolean(),
    lastAccessAt: DateLikeSchema,
});

export const SessionStruct = struct.name("Session")<z.output<typeof SessionSchema>, z.input<typeof SessionSchema>>(SessionSchema);
export type Session = StructSelf<typeof SessionStruct>;

export const PasswordPolicySchema = z.object({
    minLength: z.number(),
    requireUppercase: z.boolean(),
    requireLowercase: z.boolean(),
    requireNumbers: z.boolean(),
    requireSpecialChars: z.boolean(),
    preventReuse: z.number(),
    maxAge: z.number(),
});

export const PasswordPolicyStruct = struct.name("PasswordPolicy")<z.output<typeof PasswordPolicySchema>, z.input<typeof PasswordPolicySchema>>(PasswordPolicySchema);
export type PasswordPolicy = StructSelf<typeof PasswordPolicyStruct>;

export const AdminSettingsSchema = z.object({
    registrationEnabled: z.boolean(),
    allowNonAdminWrites: z.boolean(),
});

export const AdminSettingsStruct = struct.name("AdminSettings")<z.output<typeof AdminSettingsSchema>, z.input<typeof AdminSettingsSchema>>(AdminSettingsSchema);
export type AdminSettings = StructSelf<typeof AdminSettingsStruct>;

impl(IdentifiableTrait).for(UserStruct, {
    id: method((self: User) => self.id),
});

impl(IdentifiableTrait).for(PublicUserStruct, {
    id: method((self: PublicUser) => self.id),
});

impl(IdentifiableTrait).for(PasswordResetTokenStruct, {
    id: method((self: PasswordResetToken) => self.id),
});

impl(IdentifiableTrait).for(EmailVerificationTokenStruct, {
    id: method((self: EmailVerificationToken) => self.id),
});

impl(IdentifiableTrait).for(SessionStruct, {
    id: method((self: Session) => self.id),
});

impl(HasUserIdTrait).for(SessionStruct, {
    userId: method((self: Session) => self.userId),
});

impl(HasUserIdTrait).for(PasswordResetTokenStruct, {
    userId: method((self: PasswordResetToken) => self.userId),
});

impl(HasUserIdTrait).for(EmailVerificationTokenStruct, {
    userId: method((self: EmailVerificationToken) => self.userId),
});

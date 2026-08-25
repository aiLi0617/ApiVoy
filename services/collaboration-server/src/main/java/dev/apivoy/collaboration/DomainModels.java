package dev.apivoy.collaboration;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

enum Role { OWNER, ADMIN, EDITOR, RUNNER, VIEWER }

@Entity @Table(name = "user_accounts", uniqueConstraints = @UniqueConstraint(columnNames = "email"))
class UserAccount {
    @Id String id = UUID.randomUUID().toString();
    @Column(nullable = false) String email;
    @Column(nullable = false) String displayName;
    @Column(nullable = false) String passwordHash;
    @Column(nullable = false) Instant createdAt = Instant.now();
    protected UserAccount() {}
    UserAccount(String email, String displayName, String passwordHash) { this.email = email; this.displayName = displayName; this.passwordHash = passwordHash; }
}

@Entity @Table(name = "federated_identities", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"provider", "subject"}),
    @UniqueConstraint(columnNames = {"provider", "userId"})
})
class FederatedIdentity {
    @Id String id = UUID.randomUUID().toString();
    @Column(nullable = false) String provider;
    @Column(nullable = false) String subject;
    @Column(nullable = false) String userId;
    @Column(nullable = false) Instant createdAt = Instant.now();
    protected FederatedIdentity() {}
    FederatedIdentity(String provider, String subject, String userId) { this.provider=provider; this.subject=subject; this.userId=userId; }
}

@Entity @Table(name = "organizations")
class Organization {
    @Id String id = UUID.randomUUID().toString();
    @Column(nullable = false) String name;
    @Column(nullable = false) Instant createdAt = Instant.now();
    protected Organization() {}
    Organization(String name) { this.name = name; }
}

@Entity @Table(name = "memberships", uniqueConstraints = @UniqueConstraint(columnNames = {"organizationId", "userId"}))
class Membership {
    @Id String id = UUID.randomUUID().toString();
    @Column(nullable = false) String organizationId;
    @Column(nullable = false) String userId;
    @Enumerated(EnumType.STRING) @Column(nullable = false) Role role;
    protected Membership() {}
    Membership(String organizationId, String userId, Role role) { this.organizationId = organizationId; this.userId = userId; this.role = role; }
}

@Entity @Table(name = "device_sessions", indexes = @Index(columnList = "tokenHash", unique = true))
class DeviceSession {
    @Id String id = UUID.randomUUID().toString();
    @Column(nullable = false) String userId;
    @Column(nullable = false) String tokenHash;
    @Column(nullable = false) String deviceName;
    @Column(nullable = false) Instant expiresAt;
    Instant revokedAt;
    @Column(nullable = false) Instant createdAt = Instant.now();
    protected DeviceSession() {}
    DeviceSession(String userId, String tokenHash, String deviceName, Instant expiresAt) { this.userId = userId; this.tokenHash = tokenHash; this.deviceName = deviceName; this.expiresAt = expiresAt; }
}

@Entity @Table(name = "workspace_states", uniqueConstraints = @UniqueConstraint(columnNames = {"organizationId", "workspaceId"}))
class WorkspaceState {
    @Id String id = UUID.randomUUID().toString();
    @Version long entityVersion;
    @Column(nullable = false) String organizationId;
    @Column(nullable = false) String workspaceId;
    @Column(nullable = false) long revision;
    @Lob @Column(nullable = false) String documentJson;
    @Column(nullable = false) String updatedBy;
    @Column(nullable = false) Instant updatedAt = Instant.now();
    protected WorkspaceState() {}
    WorkspaceState(String organizationId, String workspaceId, String documentJson, String updatedBy) { this.organizationId = organizationId; this.workspaceId = workspaceId; this.documentJson = documentJson; this.updatedBy = updatedBy; }
}

@Entity @Table(name = "workspace_changes",
    indexes = @Index(columnList = "organizationId,workspaceId,revision"),
    uniqueConstraints = @UniqueConstraint(columnNames = {"organizationId", "workspaceId", "revision"}))
class WorkspaceChange {
    @Id String id = UUID.randomUUID().toString();
    @Column(nullable = false) String organizationId;
    @Column(nullable = false) String workspaceId;
    @Column(nullable = false) long revision;
    @Lob @Column(nullable = false) String patchJson;
    @Column(nullable = false) String actorId;
    @Column(nullable = false) Instant createdAt = Instant.now();
    protected WorkspaceChange() {}
    WorkspaceChange(String organizationId, String workspaceId, long revision, String patchJson, String actorId) { this.organizationId = organizationId; this.workspaceId = workspaceId; this.revision = revision; this.patchJson = patchJson; this.actorId = actorId; }
}

@Entity @Table(name = "audit_events", indexes = @Index(columnList = "organizationId,createdAt"))
class AuditEvent {
    @Id String id = UUID.randomUUID().toString();
    @Column(nullable = false) String organizationId;
    @Column(nullable = false) String actorId;
    @Column(nullable = false) String action;
    @Column(nullable = false) String resourceType;
    @Column(nullable = false) String resourceId;
    @Lob String detailsJson;
    @Column(nullable = false) Instant createdAt = Instant.now();
    protected AuditEvent() {}
    AuditEvent(String organizationId, String actorId, String action, String resourceType, String resourceId, String detailsJson) { this.organizationId = organizationId; this.actorId = actorId; this.action = action; this.resourceType = resourceType; this.resourceId = resourceId; this.detailsJson = detailsJson; }
}

@Entity @Table(name = "workspace_comments", indexes = @Index(columnList = "organizationId,workspaceId,createdAt"))
class WorkspaceComment {
    @Id String id = UUID.randomUUID().toString();
    @Column(nullable = false) String organizationId;
    @Column(nullable = false) String workspaceId;
    @Column(nullable = false) String actorId;
    String parentId;
    @Column(nullable = false, length = 4000) String body;
    Instant resolvedAt;
    String resolvedBy;
    @Column(nullable = false) Instant createdAt = Instant.now();
    @Column(nullable = false) Instant updatedAt = Instant.now();
    protected WorkspaceComment() {}
    WorkspaceComment(String organizationId, String workspaceId, String actorId, String parentId, String body) { this.organizationId=organizationId; this.workspaceId=workspaceId; this.actorId=actorId; this.parentId=parentId; this.body=body; }
}

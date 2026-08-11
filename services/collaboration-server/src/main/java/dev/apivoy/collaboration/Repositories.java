package dev.apivoy.collaboration;

import org.springframework.data.jpa.repository.JpaRepository;
import java.time.Instant;
import java.util.*;

interface UserRepository extends JpaRepository<UserAccount, String> { Optional<UserAccount> findByEmailIgnoreCase(String email); }
interface OrganizationRepository extends JpaRepository<Organization, String> {}
interface MembershipRepository extends JpaRepository<Membership, String> {
    Optional<Membership> findByOrganizationIdAndUserId(String organizationId, String userId);
    List<Membership> findByUserId(String userId);
}
interface SessionRepository extends JpaRepository<DeviceSession, String> {
    Optional<DeviceSession> findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(String tokenHash, Instant now);
}
interface WorkspaceRepository extends JpaRepository<WorkspaceState, String> { Optional<WorkspaceState> findByOrganizationIdAndWorkspaceId(String organizationId, String workspaceId); }
interface ChangeRepository extends JpaRepository<WorkspaceChange, String> { List<WorkspaceChange> findByOrganizationIdAndWorkspaceIdAndRevisionGreaterThanOrderByRevision(String organizationId, String workspaceId, long revision); }
interface AuditRepository extends JpaRepository<AuditEvent, String> { List<AuditEvent> findTop200ByOrganizationIdOrderByCreatedAtDesc(String organizationId); }
interface CommentRepository extends JpaRepository<WorkspaceComment, String> { List<WorkspaceComment> findByOrganizationIdAndWorkspaceIdOrderByCreatedAt(String organizationId, String workspaceId); }

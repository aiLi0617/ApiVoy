package dev.apivoy.collaboration;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;

@SpringBootTest(properties={"apivoy.bootstrap-token=test-bootstrap","spring.datasource.url=jdbc:h2:mem:collaboration;DB_CLOSE_DELAY=-1","spring.jpa.hibernate.ddl-auto=create-drop"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CollaborationApiTests {
    @Autowired MockMvc mvc; @Autowired ObjectMapper json;
    @Autowired CollaborationService service; @Autowired AuditRepository audits; @Autowired ChangeRepository changes; @Autowired WorkspaceRepository workspaces; @Autowired CommentRepository comments; @Autowired SessionRepository sessions; @Autowired MembershipRepository memberships; @Autowired FederatedIdentityRepository identities; @Autowired OrganizationRepository organizations; @Autowired UserRepository users;
    @BeforeEach void clean(){audits.deleteAll();comments.deleteAll();changes.deleteAll();workspaces.deleteAll();sessions.deleteAll();memberships.deleteAll();identities.deleteAll();organizations.deleteAll();users.deleteAll();}

    @Test void bootstrapProvisionSyncConflictRbacAndAudit() throws Exception {
        JsonNode owner=body(mvc.perform(post("/v1/auth/bootstrap").header("X-ApiVoy-Bootstrap-Token","test-bootstrap").contentType(MediaType.APPLICATION_JSON).content("""
          {"email":"owner@apivoy.dev","password":"correct-horse-battery","displayName":"Owner","organizationName":"Voyagers","deviceName":"test"}
        """)).andExpect(status().isOk()).andReturn());
        String ownerToken=owner.get("token").asText(), organizationId=owner.get("organizationId").asText();

        mvc.perform(get("/v1/auth/sso/config")).andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false));
        var sso=service.ssoLogin("enterprise","subject-1","sso@apivoy.dev",true,"SSO User",organizationId,Role.VIEWER,"test-idp");
        Assertions.assertEquals(Role.VIEWER,sso.role());
        Assertions.assertEquals(sso.user().id(),service.ssoLogin("enterprise","subject-1","sso@apivoy.dev",true,"Renamed",organizationId,Role.EDITOR,"test-idp").user().id());
        Assertions.assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.ssoLogin("enterprise","subject-2","unverified@apivoy.dev",false,"Unverified",organizationId,Role.VIEWER,"test-idp"));
        Assertions.assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.ssoLogin("enterprise","subject-3","admin@apivoy.dev",true,"Admin",organizationId,Role.ADMIN,"test-idp"));

        mvc.perform(options("/v1/auth/login").header("Origin","http://localhost:5180").header("Access-Control-Request-Method","POST")).andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin","http://localhost:5180"));
        mvc.perform(get("/v1/organizations/{org}/events",organizationId).header("Authorization","Bearer "+ownerToken)).andExpect(request().asyncStarted());

        mvc.perform(post("/v1/organizations/{id}/members/provision",organizationId).header("Authorization","Bearer "+ownerToken).contentType(MediaType.APPLICATION_JSON).content("""
          {"email":"viewer@apivoy.dev","password":"viewer-password","displayName":"Viewer","role":"VIEWER"}
        """)).andExpect(status().isCreated()).andExpect(jsonPath("$.role").value("VIEWER"));
        JsonNode viewer=body(mvc.perform(post("/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content("""
          {"email":"viewer@apivoy.dev","password":"viewer-password","deviceName":"browser"}
        """)).andExpect(status().isOk()).andReturn());
        String viewerToken=viewer.get("token").asText();

        mvc.perform(put("/v1/organizations/{org}/workspaces/{workspace}",organizationId,"workspace-a").header("Authorization","Bearer "+ownerToken).contentType(MediaType.APPLICATION_JSON).content("""
          {"baseRevision":0,"document":{"requests":[{"id":"r1"}]},"patch":{"op":"replace","path":"/requests"}}
        """)).andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(1));
        mvc.perform(get("/v1/organizations/{org}/workspaces/{workspace}",organizationId,"workspace-a").header("Authorization","Bearer "+viewerToken)).andExpect(status().isOk()).andExpect(jsonPath("$.document.requests[0].id").value("r1"));
        mvc.perform(put("/v1/organizations/{org}/workspaces/{workspace}",organizationId,"workspace-a").header("Authorization","Bearer "+viewerToken).contentType(MediaType.APPLICATION_JSON).content("{"+"\"baseRevision\":1,\"document\":{},\"patch\":{}"+"}")).andExpect(status().isForbidden());
        mvc.perform(put("/v1/organizations/{org}/workspaces/{workspace}",organizationId,"workspace-a").header("Authorization","Bearer "+ownerToken).contentType(MediaType.APPLICATION_JSON).content("{"+"\"baseRevision\":0,\"document\":{},\"patch\":{}"+"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("revision_conflict")).andExpect(jsonPath("$.currentRevision").value(1));
        mvc.perform(get("/v1/organizations/{org}/workspaces/{workspace}/changes",organizationId,"workspace-a").header("Authorization","Bearer "+viewerToken).param("afterRevision","0")).andExpect(status().isOk()).andExpect(jsonPath("$[0].revision").value(1));
        JsonNode comment=body(mvc.perform(post("/v1/organizations/{org}/workspaces/{workspace}/comments",organizationId,"workspace-a").header("Authorization","Bearer "+viewerToken).contentType(MediaType.APPLICATION_JSON).content("""
          {"body":"Please verify the authentication example."}
        """)).andExpect(status().isCreated()).andExpect(jsonPath("$.actorName").value("Viewer")).andReturn());
        String commentId=comment.get("id").asText();
        mvc.perform(get("/v1/organizations/{org}/workspaces/{workspace}/comments",organizationId,"workspace-a").header("Authorization","Bearer "+viewerToken)).andExpect(status().isOk()).andExpect(jsonPath("$[0].body").value("Please verify the authentication example."));
        mvc.perform(patch("/v1/organizations/{org}/workspaces/{workspace}/comments/{comment}",organizationId,"workspace-a",commentId).header("Authorization","Bearer "+viewerToken).contentType(MediaType.APPLICATION_JSON).content("""
          {"body":"Authentication example verified."}
        """)).andExpect(status().isOk()).andExpect(jsonPath("$.body").value("Authentication example verified."));
        mvc.perform(patch("/v1/organizations/{org}/workspaces/{workspace}/comments/{comment}/resolution",organizationId,"workspace-a",commentId).header("Authorization","Bearer "+viewerToken).contentType(MediaType.APPLICATION_JSON).content("""
          {"resolved":true}
        """)).andExpect(status().isForbidden());
        mvc.perform(patch("/v1/organizations/{org}/workspaces/{workspace}/comments/{comment}/resolution",organizationId,"workspace-a",commentId).header("Authorization","Bearer "+ownerToken).contentType(MediaType.APPLICATION_JSON).content("""
          {"resolved":true}
        """)).andExpect(status().isOk()).andExpect(jsonPath("$.resolvedAt").isNotEmpty());
        mvc.perform(get("/v1/organizations/{org}/audit",organizationId).header("Authorization","Bearer "+ownerToken)).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.action == 'workspace.sync')]").exists());
        mvc.perform(get("/v1/organizations/{org}/audit",organizationId).header("Authorization","Bearer "+ownerToken)).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.action == 'comment.resolve')]").exists());
        mvc.perform(get("/v1/organizations/{org}/audit",organizationId).header("Authorization","Bearer "+viewerToken)).andExpect(status().isForbidden());
    }
    private JsonNode body(org.springframework.test.web.servlet.MvcResult result)throws Exception{return json.readTree(result.getResponse().getContentAsString());}
}

@SpringBootTest(properties={"apivoy.sso.enabled=true","apivoy.sso.organization-id=organization-for-sso","spring.datasource.url=jdbc:h2:mem:sso-config;DB_CLOSE_DELAY=-1","spring.jpa.hibernate.ddl-auto=create-drop"})
@AutoConfigureMockMvc
class SsoConfigurationTests {
    @Autowired MockMvc mvc;
    @Test void exposesEnabledDiscoveryAndStartsAuthorizationCodeFlow()throws Exception {
        mvc.perform(get("/v1/auth/sso/config")).andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true)).andExpect(jsonPath("$.loginPath").value("/oauth2/authorization/oidc"));
        mvc.perform(get("/oauth2/authorization/oidc")).andExpect(status().is3xxRedirection()).andExpect(header().string("Location",org.hamcrest.Matchers.startsWith("https://invalid.local/authorize")));
    }
}

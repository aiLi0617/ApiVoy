package dev.apivoy.collaboration;

import com.fasterxml.jackson.databind.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController @RequestMapping("/v1")
class ApiController {
    private final CollaborationService service;
    ApiController(CollaborationService service){this.service=service;}

    @PostMapping("/auth/bootstrap") CollaborationService.AuthResult bootstrap(@RequestHeader("X-ApiVoy-Bootstrap-Token") String token,@Valid @RequestBody Bootstrap body){return service.bootstrap(token,body.email,body.password,body.displayName,body.organizationName,body.deviceName);}
    @PostMapping("/auth/login") CollaborationService.AuthResult login(@Valid @RequestBody Login body){return service.login(body.email,body.password,body.deviceName);}
    @PostMapping("/auth/logout") @ResponseStatus(HttpStatus.NO_CONTENT) void logout(@RequestHeader("Authorization") String authorization){service.logout(authorization.substring("Bearer ".length()));}
    @GetMapping("/organizations") List<CollaborationService.OrganizationView> organizations(Authentication auth){return service.organizations(actor(auth));}
    @GetMapping("/organizations/{organizationId}/members") List<CollaborationService.MemberView> members(Authentication auth,@PathVariable String organizationId){return service.members(actor(auth),organizationId);}
    @PostMapping("/organizations/{organizationId}/members") CollaborationService.MemberView addMember(Authentication auth,@PathVariable String organizationId,@Valid @RequestBody AddMember body){return service.addMember(actor(auth),organizationId,body.email,body.role);}
    @PostMapping("/organizations/{organizationId}/members/provision") @ResponseStatus(HttpStatus.CREATED) CollaborationService.MemberView provision(Authentication auth,@PathVariable String organizationId,@Valid @RequestBody ProvisionMember body){return service.provisionMember(actor(auth),organizationId,body.email,body.displayName,body.password,body.role);}
    @GetMapping("/organizations/{organizationId}/workspaces/{workspaceId}") CollaborationService.WorkspaceView workspace(Authentication auth,@PathVariable String organizationId,@PathVariable String workspaceId){return service.workspace(actor(auth),organizationId,workspaceId);}
    @PutMapping("/organizations/{organizationId}/workspaces/{workspaceId}") CollaborationService.WorkspaceView push(Authentication auth,@PathVariable String organizationId,@PathVariable String workspaceId,@Valid @RequestBody PushWorkspace body){return service.push(actor(auth),organizationId,workspaceId,body.baseRevision,body.document,body.patch);}
    @GetMapping("/organizations/{organizationId}/workspaces/{workspaceId}/changes") List<CollaborationService.ChangeView> changes(Authentication auth,@PathVariable String organizationId,@PathVariable String workspaceId,@RequestParam(defaultValue="0") long afterRevision){return service.changes(actor(auth),organizationId,workspaceId,afterRevision);}
    @GetMapping("/organizations/{organizationId}/audit") List<CollaborationService.AuditView> audit(Authentication auth,@PathVariable String organizationId){return service.audits(actor(auth),organizationId);}
    private String actor(Authentication auth){return String.valueOf(auth.getPrincipal());}

    record Bootstrap(@Email String email,@Size(min=10,max=200) String password,@NotBlank String displayName,@NotBlank String organizationName,String deviceName){}
    record Login(@Email String email,@NotBlank String password,String deviceName){}
    record AddMember(@Email String email,@NotNull Role role){}
    record ProvisionMember(@Email String email,@NotBlank String displayName,@Size(min=10,max=200) String password,@NotNull Role role){}
    record PushWorkspace(@Min(0) long baseRevision,@NotNull JsonNode document,JsonNode patch){}
}

@RestControllerAdvice
class ApiErrors {
    private final ObjectMapper json;
    ApiErrors(ObjectMapper json){this.json=json;}
    @ExceptionHandler(ConflictException.class) ResponseEntity<Map<String,Object>> conflict(ConflictException error){try{return ResponseEntity.status(409).body(Map.of("code","revision_conflict","message",error.getMessage(),"currentRevision",error.revision,"currentDocument",json.readTree(error.document)));}catch(Exception ignored){return ResponseEntity.status(409).body(Map.of("code","revision_conflict","currentRevision",error.revision));}}
}

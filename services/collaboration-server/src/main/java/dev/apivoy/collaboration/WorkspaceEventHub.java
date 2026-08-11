package dev.apivoy.collaboration;

import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

@Component
class WorkspaceEventHub {
    private final Map<String, CopyOnWriteArrayList<SseEmitter>> subscribers = new ConcurrentHashMap<>();

    SseEmitter subscribe(String organizationId) {
        var emitter = new SseEmitter(30L * 60L * 1000L);
        var list = subscribers.computeIfAbsent(organizationId, ignored -> new CopyOnWriteArrayList<>());
        list.add(emitter);
        Runnable remove = () -> { list.remove(emitter); if (list.isEmpty()) subscribers.remove(organizationId, list); };
        emitter.onCompletion(remove); emitter.onTimeout(remove); emitter.onError(ignored -> remove.run());
        try { emitter.send(SseEmitter.event().name("connected").data(Map.of("at", Instant.now().toString()))); } catch (IOException error) { remove.run(); }
        return emitter;
    }

    void publish(String organizationId, String workspaceId, long revision, String actorId) {
        var event = new WorkspaceChanged(workspaceId, revision, actorId, Instant.now());
        for (var emitter : subscribers.getOrDefault(organizationId, new CopyOnWriteArrayList<>())) {
            try { emitter.send(SseEmitter.event().id(workspaceId + ":" + revision).name("workspace.changed").data(event)); }
            catch (IOException error) { emitter.completeWithError(error); }
        }
    }
    void publishComment(String organizationId,String workspaceId,String commentId,String action,String actorId){send(organizationId,"comment.changed",commentId+":"+action,new CommentChanged(workspaceId,commentId,action,actorId,Instant.now()));}
    private void send(String organizationId,String name,String id,Object data){for(var emitter:subscribers.getOrDefault(organizationId,new CopyOnWriteArrayList<>())){try{emitter.send(SseEmitter.event().id(id).name(name).data(data));}catch(IOException error){emitter.completeWithError(error);}}}
    int subscriberCount(String organizationId) { return subscribers.getOrDefault(organizationId, new CopyOnWriteArrayList<>()).size(); }
    record WorkspaceChanged(String workspaceId, long revision, String actorId, Instant at) {}
    record CommentChanged(String workspaceId,String commentId,String action,String actorId,Instant at) {}
}

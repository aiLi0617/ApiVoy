import assert from "node:assert/strict";
import { amqpRequestEnvelope, kafkaRequestEnvelope, mqttRequestEnvelope, redisRequestEnvelope, sqlRequestEnvelope } from "./requestEnvelopeAdapters";

const redis = redisRequestEnvelope({ name: "Read user", target: "redis://localhost:6379", username: "", passwordRef: "", database: 0, commands: [["GET", "user:1"]], timeoutMs: 1_000 });
assert.equal(redis.protocolId, "redis");
assert.equal(redis.name, "Read user");
assert.equal(redis.payload.type, "raw");
assert.deepEqual((redis.payload as { value: { commands: string[][] } }).value.commands, [["GET", "user:1"]]);

const mqtt = mqttRequestEnvelope({ name: "Publish", target: "mqtt://localhost", mode: "publish", clientId: "client", username: "", passwordRef: "", cleanSession: true, keepAliveSeconds: 30, topic: "events", payload: "hello", encoding: "text", qos: 1, retain: false, receiveLimit: 1, caPemRef: "", serverName: "", timeoutMs: 1_000 });
assert.equal(mqtt.protocolId, "mqtt");
assert.equal(mqtt.payload.type, "raw");
assert.equal((mqtt.payload as { value: { payload: string } }).value.payload, "hello");

const amqp = amqpRequestEnvelope({ name: "AMQP", target: "amqp://localhost", mode: "publish", username: "", passwordRef: "", exchange: "events", exchangeType: "topic", routingKey: "created", queue: "", declare: false, durable: false, autoAck: false, receiveLimit: 1, payload: "{}", encoding: "text", contentType: "application/json", timeoutMs: 1_000 });
assert.equal(amqp.protocolId, "amqp");

const kafka = kafkaRequestEnvelope({ name: "Kafka", target: "localhost:9092", mode: "produce", topic: "events", key: "1", payload: "{}", encoding: "text", partition: null, groupId: "group", offsetReset: "latest", autoCommit: false, receiveLimit: 1, securityProtocol: "PLAINTEXT", saslMechanism: "PLAIN", username: "", passwordRef: "", caPemRef: "", certificatePemRef: "", keyPemRef: "", keyPasswordRef: "", timeoutMs: 1_000 });
assert.equal(kafka.protocolId, "kafka");

const sql = sqlRequestEnvelope({ name: "SQL", target: "postgres://localhost", username: "", passwordRef: "", sql: "select 1", parameters: [], transactional: false, rowLimit: 100, timeoutMs: 1_000 });
assert.equal(sql.protocolId, "sql");
assert.equal(sql.payload.type, "raw");
assert.equal((sql.payload as { value: { sql: string } }).value.sql, "select 1");

console.log("Request envelope adapter tests passed");

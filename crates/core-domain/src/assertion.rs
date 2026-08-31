use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssertionTarget { Status, Header, Body, JsonPath, Duration, Size }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssertionOperator { Equals, NotEquals, In, GreaterThan, LessThan, Contains, NotContains, Exists, NotExists, TypeIs, LengthEquals, LengthGreaterThan, LengthLessThan }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assertion {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub target: AssertionTarget,
    pub operator: AssertionOperator,
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(default)]
    pub expected: Option<String>,
}

fn default_true() -> bool { true }

impl Assertion {
    pub fn name(&self) -> String {
        let target = match self.target {
            AssertionTarget::Status => "status".into(),
            AssertionTarget::Header => format!("header[{}]", self.selector.as_deref().unwrap_or("")),
            AssertionTarget::Body => "body".into(),
            AssertionTarget::JsonPath => format!("jsonpath {}", self.selector.as_deref().unwrap_or("$")),
            AssertionTarget::Duration => "duration".into(),
            AssertionTarget::Size => "size".into(),
        };
        format!("{target} {}", self.operator.label())
    }
}

impl AssertionOperator {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Equals => "==", Self::NotEquals => "!=", Self::In => "in", Self::GreaterThan => ">", Self::LessThan => "<",
            Self::Contains => "contains", Self::NotContains => "not contains", Self::Exists => "exists", Self::NotExists => "not exists",
            Self::TypeIs => "type is", Self::LengthEquals => "length ==", Self::LengthGreaterThan => "length >", Self::LengthLessThan => "length <",
        }
    }
}

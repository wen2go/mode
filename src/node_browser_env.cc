#include "node_binding.h"
#include "node_external_reference.h"
#include "util-inl.h"

namespace node::browser_env {

using v8::Array;
using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Intercepted;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::Name;
using v8::Object;
using v8::ObjectTemplate;
using v8::PropertyCallbackInfo;
using v8::String;
using v8::Value;

namespace {

constexpr int kDelegateField = 0;

Local<Object> GetDelegate(const PropertyCallbackInfo<Value>& info) {
  return info.HolderV2()
      ->GetInternalField(kDelegateField)
      .As<Value>()
      .As<Object>();
}

Local<Object> GetDelegate(const FunctionCallbackInfo<Value>& args) {
  return args.This()->GetInternalField(kDelegateField).As<Value>().As<Object>();
}

template <typename CallbackInfo>
bool CallDelegate(Local<Context> context,
                  Local<Object> delegate,
                  Local<Value> method_name,
                  int argc,
                  Local<Value>* argv,
                  const CallbackInfo& info) {
  Local<Value> method;
  if (!delegate->Get(context, method_name).ToLocal(&method) ||
      !method->IsFunction()) {
    return false;
  }

  Local<Value> value;
  if (method.As<Function>()->Call(context, delegate, argc, argv).ToLocal(&value)) {
    info.GetReturnValue().Set(value);
    return true;
  }
  return false;
}

Intercepted GetNamedProperty(Local<Name> name,
                             const PropertyCallbackInfo<Value>& info) {
  Isolate* isolate = info.GetIsolate();
  Local<Value> argv[] = { name };
  return CallDelegate(isolate->GetCurrentContext(),
                      GetDelegate(info),
                      FIXED_ONE_BYTE_STRING(isolate, "get"),
                      1,
                      argv,
                      info) ?
      Intercepted::kYes : Intercepted::kNo;
}

Intercepted GetIndexedProperty(uint32_t index,
                               const PropertyCallbackInfo<Value>& info) {
  Isolate* isolate = info.GetIsolate();
  Local<Value> argv[] = { Integer::NewFromUnsigned(isolate, index) };
  return CallDelegate(isolate->GetCurrentContext(),
                      GetDelegate(info),
                      FIXED_ONE_BYTE_STRING(isolate, "get"),
                      1,
                      argv,
                      info) ?
      Intercepted::kYes : Intercepted::kNo;
}

void CallAsFunction(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Array> values = Array::New(isolate, args.Length());
  for (int i = 0; i < args.Length(); i++) {
    values->Set(context, i, args[i]).Check();
  }
  Local<Value> argv[] = { values };
  CallDelegate(context,
               GetDelegate(args),
               FIXED_ONE_BYTE_STRING(isolate, "call"),
               1,
               argv,
               args);
}

}  // namespace

void CreateDocumentAll(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() != 1 || !args[0]->IsObject()) {
    isolate->ThrowException(v8::Exception::TypeError(
        FIXED_ONE_BYTE_STRING(isolate, "The document.all delegate must be an object")));
    return;
  }

  Local<FunctionTemplate> function_template = FunctionTemplate::New(isolate);
  Local<ObjectTemplate> instance_template = function_template->InstanceTemplate();
  instance_template->SetInternalFieldCount(1);
  instance_template->MarkAsUndetectable();
  instance_template->SetCallAsFunctionHandler(CallAsFunction);
  instance_template->SetHandler(v8::NamedPropertyHandlerConfiguration(
      GetNamedProperty));
  instance_template->SetHandler(v8::IndexedPropertyHandlerConfiguration(
      GetIndexedProperty));

  Local<Function> constructor;
  if (!function_template->GetFunction(context).ToLocal(&constructor)) return;
  Local<Object> result;
  if (!constructor->NewInstance(context).ToLocal(&result)) return;
  result->SetInternalField(kDelegateField, args[0]);
  args.GetReturnValue().Set(result);
}

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context,
                void* priv) {
  SetMethod(context, target, "createDocumentAll", CreateDocumentAll);
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(CreateDocumentAll);
  registry->Register(GetNamedProperty);
  registry->Register(GetIndexedProperty);
  registry->Register(CallAsFunction);
}

}  // namespace node::browser_env

NODE_BINDING_CONTEXT_AWARE_INTERNAL(browser_env, node::browser_env::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(browser_env,
                                node::browser_env::RegisterExternalReferences)
